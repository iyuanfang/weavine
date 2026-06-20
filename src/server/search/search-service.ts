import { parseQuery } from './parser';
import { executeSearch } from './executor';

export const SearchService = {
  async run(ownerId: string, q: string) {
    const parsed = parseQuery(q);
    const hits = await executeSearch(ownerId, parsed);
    return { parsed, hits };
  },
};
