#!/usr/bin/env node
import path from 'path';
import process from 'process';

import { program } from 'commander';
import dotenv from 'dotenv';
dotenv.config()

import { GithubFetcher } from './fetch-github';
import { GitFetcher } from './fetch-git';
import { braveVersionsDir, ensureDirExists, multibar, writeJSON } from './util';
import pkg from '../package.json';

async function main() {
  program
    .name(pkg.name)
    .version(pkg.version)
    .option('--brave-browser <dir>', 'existing brave-browser git repo',
            braveVersionsDir('brave-browser'))
    .option('--cache-dir <dir>', 'cache in dir', braveVersionsDir())
    .option('--cache-github-releases', 'enable cached github releases', false)
    .option('--no-git-pull', 'skip git pull in brave-browser (default: git pull to update)')
    .option('-o, --output <file>', 'path to output json manifest (default: brave-versions.json)');
  program.parse(process.argv);


  const {
    braveBrowser,
    cacheGithubReleases,
    cacheDir,
    gitPull,
    output,
  } = program;

  console.log({
    braveBrowser,
    cacheGithubReleases,
    cacheDir,
    gitPull,
    output,
  });

  await ensureDirExists(cacheDir);

  let ghFetcher = new GithubFetcher({ cache: cacheGithubReleases, cacheDir });
  let gitFetcher = new GitFetcher({ dir: braveBrowser, gitPull });

  const [gitReleases] = await Promise.all([
    (async function() {
      await gitFetcher.updateRepo();
      return await gitFetcher.fetchGitReleases();
    })(),
    ghFetcher.fetchReleases(),
  ]);

  const ghReleases = await ghFetcher.update(gitReleases);
  const finalReleases = {};

  for (const [tag, ghRelease] of Object.entries(ghReleases)) {
    if (!(tag in gitReleases)) {
      continue;
    }

    if (ghRelease.prerelease || ghRelease.draft) {
      continue;
    }

    let gitRelease = gitReleases[tag];
    let finalRelease = {
      tag,
      name: tag.substring(1),
      channel: ghRelease.name.split(' ')[0].toLowerCase(),
      commit: gitRelease.commit,
      published: ghRelease.published_at,
      dependencies: {
        chrome: ghRelease.name.match('(Chromium )\(([0-9\.])+\)')[2],
      },
      github: {
        release_id: ghRelease.id,
        assets: ghRelease.assets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          download_url: asset.browser_download_url,
        })),
      },
    };

    finalReleases[tag] = finalRelease;
  }

  let bvPath = output || path.join(process.cwd(), 'brave-versions.json');
  await writeJSON(bvPath, finalReleases);
  multibar.stop();

  console.log(`wrote final data to ${bvPath}`);
}

main();
