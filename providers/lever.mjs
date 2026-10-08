import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://api.lever.co/v0/postings/';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.text, job.title, job.headline),
    url: firstPresent(job.hostedUrl, job.url),
    company: firstPresent(job.company, context.company, context.name),
    location: text(job.categories?.location ?? job.location),
    description: String(job.descriptionPlain ?? job.description ?? ''),
    postedAt: text(job.createdAt ?? job.firstPublishedDate),
    externalId: text(job.id),
  };
}

export default {
  id: 'lever',
  hosts: ['api.lever.co'],
  keyword: (url) => hostOf(url) === 'api.lever.co',
  detect: (entry) => {
    const company = firstPresent(entry.company, entry.board, entry.key);
    if (!company) return null;
    return { url: `${API_BASE}${encodeURIComponent(company)}?mode=json` };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    return arrayOf(data).map((job) => postingFromJob(job, entry));
  },
};