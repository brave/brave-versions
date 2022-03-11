import path from 'path';
import process from 'process';
import url from 'url';

import axios from 'axios';

import { multibar, pathExists, readJSON, sleep, writeJSON } from './util';

const RELEASES_URL = 'https://api.github.com/repos/brave/brave-browser/releases';

export class GithubFetcher {
  constructor({ cache, cacheDir }) {
    this.cache = cache;
    this.cacheDir = cacheDir;
    this.releases = {};
  }

  async fetchReleases() {
    if (this.cache) {
      let ghReleases = path.join(this.cacheDir, 'gh-releases.json');
      if (await pathExists(ghReleases)) {
        this.releases = await readJSON(ghReleases);
      }
    }

    if (!this.releases || !Object.getOwnPropertyNames(this.releases).length) {
      await this.fetchAll();
      await this.writeReleases();
    }
    return this.releases;
  }

  async update() {
    // This just grabs the 1st page of releases instead of trying to be smart
    const response = await this.githubGet(`${RELEASES_URL}`);
    this.insertReleases(response.data);

    await this.writeReleases();
    return this.releases;
  }

  async githubGet(url) {
    try {
      const headers = { 'Accept': 'application/vnd.github.v3+json' };
      if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }

      return await axios.get(url, { headers });
    } catch (err) {
      console.error(err);
    }
  }

  async writeReleases() {
    if (this.cache) {
      await writeJSON(this.ghReleasesPath, this.releases);
    }
  }

  parseLinks(links) {
    const reg = /<([^>]+)>; rel="([^"]+)"/g;
    const map = {};

    for (const [, url, rel] of links.matchAll(reg)) {
      map[rel] = url;
    }

    return map;
  }

  insertReleases(releases) {
    for (let release of releases) {
      // trim out unnecessary data
      delete release.author;
      for (const asset of release.assets) {
        delete asset.uploader;
      }

      this.releases[release.tag_name] = release;
    }
  }

  async fetchAll() {
    const perPage = 100;
    const batchSize = 4;
    const response = await this.githubGet(`${RELEASES_URL}?per_page=${perPage}`);
    this.insertReleases(response.data);

    const links = this.parseLinks(response.headers.link);
    const nextUrl = new URL(links.next);
    const lastUrl = new URL(links.last);
    const baseUrl = url.format(nextUrl, { search: false })
    const pageCount = Math.min(10, parseFloat(lastUrl.searchParams.get('page')));
    let progress = multibar.create(pageCount - 1, 0, { title: 'gh releases', filename: 'N/A' });

    let toFetch = [];
    let currentBatch = [];
    for (let i = 2; i <= pageCount; i++) {
      let url = new URL(baseUrl);
      url.searchParams.set('page', String(i));
      url.searchParams.set('per_page', String(perPage));
      currentBatch.push(url.toString());

      if (currentBatch.length === batchSize) {
        toFetch.push(currentBatch);
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      toFetch.push(currentBatch);
    }

    for (let batch of toFetch) {
      let rateLimitRemaining = 0;
      let rateLimitReset;

      for (const response of await Promise.all(batch.map(async(url) => {
        progress.increment();
        return await this.githubGet(url);
      }))) {
        this.insertReleases(response.data);
        rateLimitRemaining = parseInt(response.headers['x-ratelimit-remaining'])
        rateLimitReset = new Date(parseInt(response.headers['x-ratelimit-reset']) * 1000)
      }

      if (rateLimitRemaining < 10) {
        const delta = rateLimitReset - Date.now();
        console.log(`getting close to rate limit, back off for ${delta/1000} sec`);
        await sleep(delta);
      }
    }

    return this.releases;
  }
}


