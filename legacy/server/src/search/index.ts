export {
	handleSearchPerGateway,
	handleSearchTopLevel,
	isSearchRequest,
	parseSearchParams,
} from "./handler.js";
export {
	createSearchIndex,
	quoteFtsPhrase,
	rebuildSearchIndex,
	searchSessions,
} from "./sqlite-index.js";
export type {
	IndexTurnInput,
	PersistedSessionRow,
	SearchHit,
	SearchIndex,
	SearchOptions,
	SearchRebuildOcas,
	SearchResult,
	SessionMetaInput,
} from "./types.js";
