import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://remotejobs.org/api/v1/jobs';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.title, job.name),
    url: firstPresent(job.url, job.apply_url),
    company: firstPresent(job.company?.name, job.company_name, context.company, context.name),
    location: text(job.location ?? job.city),
    description: String(job.description ?? ''),
    postedAt: text(job.posted_at ?? job.pub_date),
    externalId: text(job.id ?? job.slug),
  };
}

export default {
  id: 'remotejobs',
  hosts: ['remotejobs.org'],
  keyword: (url) => hostOf(url).endsWith('remotejobs.org'),
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