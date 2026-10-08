import { text, firstPresent, hostOf } from './_util.mjs';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.position, job.title),
    url: firstPresent(job.url, job.apply_url),
    company: firstPresent(job.company, context.company, context.name),
    location: text(job.location),
    description: String(job.description ?? ''),
    postedAt: firstPresent(job.date, job.epoch?.toString()),
    externalId: text(job.id ?? job.url),
  };
}

export default {
  id: 'remoteok',
  hosts: ['remoteok.com'],
  keyword: (url) => hostOf(url) === 'remoteok.com',
  detect: (entry) => {
    const path = firstPresent(entry.endpoint, entry.key);
    return path ? { url: `https://remoteok.com/${path}` } : { url: 'https://remoteok.com/api' };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (Array.isArray(data)) {
      return data.filter((job) => job && job.url).map((job) => postingFromJob(job, entry));
    }
    return [];
  },
};