import { parseQuery } from './parser';
import { executeSearch } from './executor';

export const SearchService = {
  async run(q: string) {
    const parsed = parseQuery(q);
    const hits = await executeSearch(parsed);
    return { parsed, hits };
  },
};
