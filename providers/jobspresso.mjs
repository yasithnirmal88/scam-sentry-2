import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const TIMEOUT_MS = 15000;

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.title, job.position),
    url: firstPresent(job.url, job.posting_url, job.apply_url),
    company: firstPresent(job.company, context.company, context.name),
    location: text(job.location),
    description: String(job.description ?? ''),
    postedAt: firstPresent(job.date, job.created_at),
    externalId: text(job.id ?? job.url),
  };
}

export default {
  id: 'jobspresso',
  hosts: ['jobspresso.co'],
  keyword: (url) => hostOf(url) === 'jobspresso.co',
  detect: (entry) => {
    const endpoint = firstPresent(entry.endpoint, entry.key);
    return { url: endpoint ? (endpoint.startsWith('http') ? endpoint : `https://jobspresso.co/${endpoint}`) : 'https://jobspresso.co/api/v1/postings' };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJsonWithRetry(seed.url, { redirect: 'error', timeoutMs: TIMEOUT_MS });
    const jobs = Array.isArray(data) ? data : arrayOf(data?.jobs ?? data?.data);
    return jobs.map((job) => postingFromJob(job, entry));
  },
};