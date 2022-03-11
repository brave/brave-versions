import { spawn } from 'child_process';
import { once } from 'events';
import process from 'process';
import readline from 'readline';

import { multibar, pathExists } from './util';

export class GitFetcher {
  constructor({ dir, gitPull }) {
    this.dir = dir;
    this.gitPull = gitPull;
  }

  async updateRepo() {
    let argv, cwd;

    if (!await pathExists(this.dir)) {
      argv = ['clone', 'https://github.com/brave/brave-browser', this.dir]
    } else {
      if (!this.gitPull) {
        console.log(`[brave-browser] skip pull`);
        return true;
      }

      argv = ['pull', '--tags']
      cwd = this.dir;
    }

    console.log(`[brave-browser]: git ${argv.join(' ')}`);
    let cmd = spawn('git', argv, { cwd });
    cmd.stdout.pipe(process.stdout);
    cmd.stderr.pipe(process.stderr);

    if (await new Promise((resolve, reject) => {
      cmd.on('exit', resolve);
      cmd.on('error', reject);
    }) !== 0) {
      console.error('Error updating brave-browser');
      return false;
    }

    return true;
  }

  async fetchGitReleases() {
    const releases = {};
    let cmd = spawn('git', ['tag', '-l', 'v*', '--format', '%(objectname) %(refname:strip=2)'],
      { cwd: this.dir});

    const rl = readline.createInterface({
      input: cmd.stdout,
      crlfDelay: Infinity
    });

    const tags = [];
    for await (const line of rl) {
      const [commit, tag] = line.trim().split(' ');
      if (tag.startsWith('v0')) {
        // Skip pre-1.0 tags
        continue;
      }

      tags.push([commit, tag]);
    }

    const progress = multibar.create(tags.length, 0, { title: 'package.json' });
    for (const [commit, tag] of tags) {
      releases[tag] = { commit };

      let packageJson = spawn('git', ['show', `${tag}:package.json`], { cwd: this.dir });
      let json = '';
      packageJson.stdout.on('data', (data) => json += data.toString());
      await once(packageJson, 'exit');

      try {
        let pkg = JSON.parse(json);
        releases[tag].chrome_version = pkg.config.projects.chrome.tag
        progress.increment({ filename: tag });
      } catch (e) {
        continue;
      }
    }

    return releases;
  }
}
