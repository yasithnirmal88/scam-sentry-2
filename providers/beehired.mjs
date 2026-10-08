import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://beehired.com/api/v1/jobs';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.title, job.name),
    url: firstPresent(job.url, job.apply_url),
    company: firstPresent(job.company_name, job.company?.name, job.company, context.company, context.name),
    location: text(job.location_name ?? job.location),
    description: String(job.description ?? ''),
    postedAt: text(job.created_at ?? job.published_at),
    externalId: text(job.id ?? job.url),
  };
}

export default {
  id: 'beehired',
  hosts: ['beehired.com'],
  keyword: (url) => hostOf(url).endsWith('beehired.com'),
  detect: (entry) => {
    const company = firstPresent(entry.company, entry.board, entry.key);
    if (!company) return null;
    return { url: `${API_BASE}?company=${encodeURIComponent(company)}` };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data) return [];
    const records = Array.isArray(data) ? data : arrayOf(data.jobs ?? data.data ?? data.results);
    return records.map((job) => postingFromJob(job, entry));
  },
};