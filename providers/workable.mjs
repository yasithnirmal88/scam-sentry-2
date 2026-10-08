import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://apply.workable.com/api/v1/widget/accounts/';

function postingFromJob(job, context) {
  return {
    title: text(job.title),
    url: firstPresent(job.url, job.shortcode ? `https://apply.workable.com/j/${job.shortcode}` : job.apply_url),
    company: firstPresent(job.company?.name ?? job.company, context.company, context.name),
    location: firstPresent(job.location?.city, job.location?.country, job.city),
    description: String(job.description ?? ''),
    postedAt: text(job.created_at ?? job.published),
    externalId: text(job.id ?? job.shortcode),
  };
}

export default {
  id: 'workable',
  hosts: ['apply.workable.com'],
  keyword: (url) => hostOf(url).endsWith('workable.com'),
  detect: (entry) => {
    const company = firstPresent(entry.company, entry.board, entry.key);
    if (!company) return null;
    return { url: `${API_BASE}${encodeURIComponent(company)}/jobs` };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data) return [];
    const records = Array.isArray(data) ? data : arrayOf(data.results ?? data.jobs ?? data.data);
    return records.map((job) => postingFromJob(job, entry));
  },
};