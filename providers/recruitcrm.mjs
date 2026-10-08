import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://api.recruitcrm.io/v1/jobs';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.title, job.name),
    url: firstPresent(job.url, job.apply_url, job.public_url),
    company: firstPresent(job.company_name, context.company, context.name),
    location: text(job.location ?? job.city),
    description: String(job.description ?? ''),
    postedAt: text(job.created_at ?? job.updated_at),
    externalId: text(job.id ?? job.url),
  };
}

export default {
  id: 'recruitcrm',
  hosts: ['api.recruitcrm.io'],
  keyword: (url) => hostOf(url) === 'api.recruitcrm.io',
  detect: (entry) => {
    const company = firstPresent(entry.company, entry.key, entry.board);
    if (!company) return null;
    const search = firstPresent(entry.search);
    return { url: search ? `${API_BASE}?company=${encodeURIComponent(company)}&search=${encodeURIComponent(search)}` : `${API_BASE}?company=${encodeURIComponent(company)}` };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data) return [];
    const records = Array.isArray(data) ? data : arrayOf(data.results ?? data.items ?? data.data);
    return records.map((job) => postingFromJob(job, entry));
  },
};