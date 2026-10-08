import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://boards-api.greenhouse.io/v1/boards/';

function postingFromJob(job, context) {
  return {
    title: text(job.title),
    url: text(job.absolute_url),
    company: firstPresent(job.company_name, context.company, context.name),
    location: text(job.location?.name),
    description: String(job.content ?? ''),
    postedAt: text(job.updated_at),
    externalId: text(job.id),
  };
}

export default {
  id: 'greenhouse',
  hosts: ['boards-api.greenhouse.io'],
  keyword: (url) => {
    const host = hostOf(url);
    return host === 'boards-api.greenhouse.io';
  },
  detect: (entry) => {
    const token = firstPresent(entry.board, entry.company, entry.key);
    if (!token) return null;
    return { url: `${API_BASE}${encodeURIComponent(token)}/jobs` };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data || !Array.isArray(data.jobs)) return [];
    return arrayOf(data.jobs).map((job) => postingFromJob(job, entry));
  },
};