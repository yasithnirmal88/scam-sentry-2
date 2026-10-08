import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.title, job.name),
    url: firstPresent(job.url, job.link),
    company: firstPresent(job.company_name, job.company, context.company, context.name),
    location: text(job.location ?? job.category),
    description: String(job.description ?? ''),
    postedAt: text(job.pub_date ?? job.created_at),
    externalId: text(job.id ?? job.url),
  };
}

export default {
  id: 'workingnomads',
  hosts: ['www.workingnomads.com'],
  keyword: (url) => hostOf(url).endsWith('workingnomads.com'),
  detect: (entry) => {
    const endpoint = firstPresent(entry.endpoint, entry.key);
    return { url: endpoint ? (endpoint.startsWith('http') ? endpoint : `https://${endpoint}`) : 'https://www.workingnomads.com/api/external_jobs' };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    const jobs = Array.isArray(data) ? data : arrayOf(data?.jobs ?? data?.data);
    return jobs.map((job) => postingFromJob(job, entry));
  },
};