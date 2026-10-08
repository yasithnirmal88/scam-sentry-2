import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://api.ashbyhq.com/posting-api/job-board/';

function postingFromJob(job, context) {
  return {
    title: text(job.title),
    url: firstPresent(job.jobUrl, job.url),
    company: firstPresent(job.company?.name ?? job.companyName, context.company, context.name),
    location: firstPresent(job.location, job.secondaryLocation),
    description: String(job.descriptionHtml ?? ''),
    postedAt: text(job.publishedAt ?? job.lastUpdatedAt),
    externalId: text(job.jobUrl ?? job.id),
  };
}

export default {
  id: 'ashby',
  hosts: ['api.ashbyhq.com'],
  keyword: (url) => hostOf(url) === 'api.ashbyhq.com',
  detect: (entry) => {
    const company = firstPresent(entry.company, entry.board, entry.key);
    if (!company) return null;
    return { url: `${API_BASE}${encodeURIComponent(company)}` };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data || !Array.isArray(data.jobs)) return [];
    return arrayOf(data.jobs).map((job) => postingFromJob(job, entry));
  },
};