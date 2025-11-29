// scoreAc.ts
import { getAcceptanceScore } from "./helper";

export async function scoreAcceptanceCriteria(criteria: string) {
  return await getAcceptanceScore(criteria);
}
