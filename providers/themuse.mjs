import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

function postingFromJob(job, context) {
  return {
    title: text(job.name ?? job.title),
    url: firstPresent(job.refs?.landing_page, job.url),
    company: firstPresent(job.company?.name ?? job.company, context.company, context.name),
    location: text(job.locations?.[0]?.name ?? job.location),
    description: String(job.contents ?? job.description ?? ''),
    postedAt: text(job.published_at ?? job.posted_at ?? job.first_published_at),
    externalId: text(job.id ?? job.short_id),
  };
}

export default {
  id: 'themuse',
  hosts: ['www.themuse.com'],
  keyword: (url) => hostOf(url).endsWith('themuse.com'),
  detect: (entry) => {
    const endpoint = firstPresent(entry.endpoint, entry.key);
    if (endpoint) return { url: `https://www.themuse.com/${endpoint}` };
    return { url: 'https://www.themuse.com/api/public/jobs' };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data) return [];
    const records = Array.isArray(data) ? data : arrayOf(data.results ?? data.data);
    return records.map((job) => postingFromJob(job, entry));
  },
};