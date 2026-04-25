const TVDB_BASE = "https://api4.thetvdb.com/v4";
type TvdbLoginResponse = { data?: { token?: string } };
type TvdbSearchResponse = {
	data?: Array<{
		tvdb_id?: number;
		name?: string;
		type?: string;
	}>;
};
type TvdbMovieResponse = {
	data?: {
		id: number;
		runtime?: number; // minutes (typically)
		artworks?: Array<{
			image?: string;
			type?: number;
			language?: string;
		}>;
	};
};
type ParsedMovieName = { movie: string; year: string | null };
type MovieDetails = {
	runtime: number, // minutes
	banner: string | null,
	icon: string | null,
};


export function parseMovieNameAndYear(input: string): ParsedMovieName {
	// Match a trailing "(1999)" (optionally with surrounding whitespace)
	const m = input.match(/^(.*?)\s*\((\d{4})\)\s*$/);

	if (!m) return { movie: input.trim(), year: null };

	const movie = m[1].trim();
	const year = m[2].toString();

	return { movie, year };
}

async function tvdbLogin(apiKey: string): Promise<string> {
	const res = await fetch(`${TVDB_BASE}/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ apikey: apiKey }),
	});

	if (!res.ok) throw new Error(`TVDB login failed (${res.status}): ${await res.text()}`);

	const json = (await res.json()) as TvdbLoginResponse;
	const token = json.data?.token;
	if (!token) throw new Error("TVDB login response missing data.token");
	return token;
}

async function tvdbSearchMovie(
	bearerToken: string,
	query: string,
	limit: any = 1,
	year: any = "",
): Promise<{ id: number; raw: any }> {
	const url = new URL(`${TVDB_BASE}/search`);
	url.searchParams.set("type", "movie");
	url.searchParams.set("query", query);
	url.searchParams.set("limit", String(limit));
	if (year !== "" && year !== null) {
		url.searchParams.set("year", year);
	}

	const res = await fetch(url.toString(), {
		method: "GET",
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${bearerToken}`,
		},
	});

	if (!res.ok) throw new Error(`TVDB search failed (${res.status}): ${await res.text()}`);

	const json = (await res.json()) as TvdbSearchResponse;
	const first = json.data?.[0];
	if (!first) throw new Error("Unable to locate movie");

	// Prefer id if present; fall back to tvdb_id
	const id = first.tvdb_id;
	if (id == null) throw new Error("Search result missing id/tvdb_id");

	return { id, raw: first };
}

async function tvdbGetMovieDetails(bearerToken: string, movieId: number): Promise<TvdbMovieResponse["data"]> {
	const res = await fetch(`${TVDB_BASE}/movies/${movieId}/extended`, {
		method: "GET",
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${bearerToken}`,
		},
	});

	if (!res.ok) throw new Error(`TVDB movie fetch failed (${res.status}): ${await res.text()}`);

	const json = (await res.json()) as TvdbMovieResponse;
	if (!json.data) throw new Error("Movie response missing data");
	return json.data;
}

export async function tvdbGetMovieInfo(apiKey: string, title: string, year: any): Promise<MovieDetails> {
	const bg_id = 15;
	const icon_id = 18;

	const bearerToken = await tvdbLogin(apiKey);
	const { id: movieId } = await tvdbSearchMovie(bearerToken, title, 1, year);
	const movie = await tvdbGetMovieDetails(bearerToken, movieId);
	if (movie == null) throw new Error("Cannot locate movie!");
	const runtime = movie.runtime;
	if (runtime == null) throw new Error("Movie response missing data.runtime");

	const artworks = movie.artworks ?? [];
	console.log(artworks)
	const banner_result: string | null = artworks.find((a: any) => a.type === bg_id && (a.language == null || a.language === "eng")) ?.image ?? null;
	const icon_result: string | null = artworks.find((a: any) => a.type === icon_id && (a.language == null || a.language === "eng")) ?.image ?? null;

	return {
		runtime: runtime,
		banner: banner_result,
		icon: icon_result,
	}
}
