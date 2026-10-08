import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://remotive.com/api/remote-jobs';

function postingFromJob(job, context) {
  return {
    title: text(job.title),
    url: firstPresent(job.url, job.application_url),
    company: firstPresent(job.company_name, context.company, context.name),
    location: text(job.candidate_required_location ?? job.city),
    description: String(job.description ?? ''),
    postedAt: text(job.publication_date),
    externalId: text(job.id),
  };
}

export default {
  id: 'remotive',
  hosts: ['remotive.com'],
  keyword: (url) => hostOf(url) === 'remotive.com',
  detect: (entry) => {
    const search = firstPresent(entry.search, entry.key);
    const tag = firstPresent(entry.tag, entry.board);
    return search
      ? { url: `${API_BASE}?${new URLSearchParams({ search, limit: String(entry.limit ?? 50) })}` }
      : tag
        ? { url: `${API_BASE}?tag=${encodeURIComponent(tag)}&limit=${String(entry.limit ?? 50)}` }
        : { url: `${API_BASE}?limit=${String(entry.limit ?? 50)}` };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data || !Array.isArray(data.jobs)) return [];
    return arrayOf(data.jobs).map((job) => postingFromJob(job, entry));
  },
};