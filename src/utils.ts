import * as core from '@actions/core';
import { prerelease, rcompare, valid } from 'semver';
// @ts-ignore
import DEFAULT_RELEASE_TYPES from '@semantic-release/commit-analyzer/lib/default-release-types';
import {
    compareCommits,
    fetchPRDetails,
    listTags
} from './github';
import { defaultChangelogRules } from './defaults';
import { Await } from './ts';
import {context} from "@actions/github";
import {stringify} from "querystring";

type Tags = Await<ReturnType<typeof listTags>>;

export async function getValidTags(
  prefixRegex: RegExp,
  shouldFetchAllTags: boolean
) {
  const tags = await listTags(shouldFetchAllTags);

  const invalidTags = tags.filter(
    (tag) => !valid(tag.name.replace(prefixRegex, ''))
  );

  invalidTags.forEach((name) => core.debug(`Found Invalid Tag: ${name}.`));

  const validTags = tags
    .filter((tag) => valid(tag.name.replace(prefixRegex, '')))
    .sort((a, b) =>
      rcompare(a.name.replace(prefixRegex, ''), b.name.replace(prefixRegex, ''))
    );

  validTags.forEach((tag) => core.debug(`Found Valid Tag: ${tag.name}.`));

  return validTags;
}

interface PayloadCommit {
    message: string;
    id: string;
}
interface FinalCommit {
    sha: string | null;
    commit: {
        message: string;
    }
}

export async function getCommits(baseRef: string, headRef: string) {
  let commits: Array<FinalCommit>|undefined = [];
  commits = await compareCommits(baseRef, headRef);
  core.info("We found "+ commits.length +" commits using classic compare!")
  if(commits.length < 1)
      commits = getClosedPRCommits();
  // core.info("We found "+ commits?.length||'unknown' +" commits after PRCommits")
  if(commits != undefined)
      return commits
        .filter((commit: FinalCommit) => !!commit.commit.message)
        .map((commit: FinalCommit) => ({
          message: commit.commit.message,
          hash: commit.sha,
        }))
    return []

}

function getClosedPRCommits(){
    let commits: Array<FinalCommit>|undefined;
    let commit: PayloadCommit;
    core.info("About to check context type");
    if( !('pull_request' in context.payload)){
        core.info("We were not a PR context");
        core.info(JSON.stringify(context.payload.commits))
        core.info("Getting payload commit length via parsing");
        let pr_commit_count = context.payload.commits.length
        core.info("We found "+pr_commit_count+" commits from the PR.")
        JSON.parse(context.payload.commits)
        if (pr_commit_count){
            commits = context.payload.commits
                .filter((commit: PayloadCommit) => !!commit.message)
                .map((commit: PayloadCommit) => ({
                    message: commit.message,
                    hash: commit.id,
                }));
        }
    }
    return commits;
}

export async function getPRDetails() {
  return fetchPRDetails();
}

export function getBranchFromRef(ref: string) {
  return ref.replace('refs/heads/', '');
}

export function isPr(ref: string) {
  return ref.includes('refs/pull/');
}

export function getLatestTag(
  tags: Tags,
  prefixRegex: RegExp,
  tagPrefix: string
) {
  return (
    tags.find((tag) => !prerelease(tag.name.replace(prefixRegex, ''))) || {
      name: `${tagPrefix}0.0.0`,
      commit: {
        sha: 'HEAD',
      },
    }
  );
}

export function getLatestPrereleaseTag(
  tags: Tags,
  identifier: string,
  prefixRegex: RegExp
) {
  return tags
    .filter((tag) => prerelease(tag.name.replace(prefixRegex, '')))
    .find((tag) => tag.name.replace(prefixRegex, '').match(identifier));
}

export function mapCustomReleaseRules(customReleaseTypes: string) {
  const releaseRuleSeparator = ',';
  const releaseTypeSeparator = ':';

  return customReleaseTypes
    .split(releaseRuleSeparator)
    .filter((customReleaseRule) => {
      const parts = customReleaseRule.split(releaseTypeSeparator);

      if (parts.length < 2) {
        core.warning(
          `${customReleaseRule} is not a valid custom release definition.`
        );
        return false;
      }

      const defaultRule = defaultChangelogRules[parts[0].toLowerCase()];
      if (customReleaseRule.length !== 3) {
        core.debug(
          `${customReleaseRule} doesn't mention the section for the changelog.`
        );
        core.debug(
          defaultRule
            ? `Default section (${defaultRule.section}) will be used instead.`
            : "The commits matching this rule won't be included in the changelog."
        );
      }

      if (!DEFAULT_RELEASE_TYPES.includes(parts[1])) {
        core.warning(`${parts[1]} is not a valid release type.`);
        return false;
      }

      return true;
    })
    .map((customReleaseRule) => {
      const [type, release, section] = customReleaseRule.split(
        releaseTypeSeparator
      );
      const defaultRule = defaultChangelogRules[type.toLowerCase()];

      return {
        type,
        release,
        section: section || defaultRule?.section,
      };
    });
}

export function mergeWithDefaultChangelogRules(
  mappedReleaseRules: ReturnType<typeof mapCustomReleaseRules> = []
) {
  const mergedRules = mappedReleaseRules.reduce(
    (acc, curr) => ({
      ...acc,
      [curr.type]: curr,
    }),
    { ...defaultChangelogRules }
  );

  return Object.values(mergedRules).filter((rule) => !!rule.section);
}
