import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://www.workatastartup.com/jobs.json?raw=true';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.title, job.role_title, job.name),
    url: firstPresent(job.url, job.job_url),
    company: firstPresent(job.company_name, job.company?.name, context.company, context.name),
    location: text(job.location ?? job.locations?.[0] ?? job.location_name),
    description: String(job.description ?? ''),
    postedAt: text(job.created_at ?? job.published_at),
    externalId: text(job.id ?? job.url),
  };
}

export default {
  id: 'workatastartup',
  hosts: ['www.workatastartup.com'],
  keyword: (url) => hostOf(url).endsWith('workatastartup.com'),
  detect: (entry) => {
    const endpoint = firstPresent(entry.endpoint, entry.key);
    return { url: endpoint ? (endpoint.startsWith('http') ? endpoint : `https://${endpoint}`) : API_BASE };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!Array.isArray(data)) return [];
    return data.filter((job) => job && (job.title || job.role_title)).map((job) => postingFromJob(job, entry));
  },
};