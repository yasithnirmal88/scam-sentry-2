import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://api.smartrecruiters.com/v1/companies/';

function postingFromJob(job, context) {
  return {
    title: text(job.name ?? job.title),
    url: firstPresent(job.ref ?? job.url, job.applyUrl),
    company: job.company?.name ? text(job.company.name) : firstPresent(job.company, context.company, context.name),
    location: firstPresent(job.location?.city, job.location?.country),
    description: String(job.jobDescription ?? job.description ?? ''),
    postedAt: text(job.releasedDate ?? job.postedOn ?? job.postedDate),
    externalId: text(job.id ?? job.identifier),
  };
}

export default {
  id: 'smartrecruiters',
  hosts: ['api.smartrecruiters.com'],
  keyword: (url) => hostOf(url) === 'api.smartrecruiters.com',
  detect: (entry) => {
    const company = firstPresent(entry.company, entry.board, entry.key);
    if (!company) return null;
    return { url: `${API_BASE}${encodeURIComponent(company)}/postings` };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data || !Array.isArray(data.content)) return [];
    return arrayOf(data.content).map((job) => postingFromJob(job, entry));
  },
};