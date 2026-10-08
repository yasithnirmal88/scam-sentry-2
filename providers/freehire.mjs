import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://freehire.me/api/v1/jobs';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.title, job.jobTitle),
    url: firstPresent(job.url, job.apply_url),
    company: firstPresent(job.company, job.company_name, context.company, context.name),
    location: text(job.location),
    description: String(job.description ?? ''),
    postedAt: text(job.posted_at ?? job.published_at),
    externalId: text(job.external_id ?? job.public_slug ?? job.id),
  };
}

export default {
  id: 'freehire',
  hosts: ['freehire.me'],
  keyword: (url) => hostOf(url).endsWith('freehire.me'),
  detect: (entry) => {
    const endpoint = firstPresent(entry.endpoint, entry.key);
    return { url: endpoint ? (endpoint.startsWith('http') ? endpoint : `https://${endpoint}`) : API_BASE };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data) return [];
    const records = Array.isArray(data) ? data : arrayOf(data.jobs ?? data.data);
    return records.map((job) => postingFromJob(job, entry));
  },
};