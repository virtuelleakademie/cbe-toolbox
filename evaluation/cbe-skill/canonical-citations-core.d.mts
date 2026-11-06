export declare const CANONICAL: RegExp;
export declare const ANY_CORPUS_TOKEN: RegExp;
export declare function isWellFormedToken(token: string): boolean;
export declare function findNonCanonicalCitations(text: string): { token: string; line: number }[];
export declare function allCitedIds(text: string): string[];
export declare function canonicalCitedIds(text: string): string[];
