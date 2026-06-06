const STEAM_API_URL = "https://api.steampowered.com";

export const STEAM_BATCH_SIZE = 100;

export type SteamGame = {
	appid: number;
	name: string;
	playtime_forever: number;  // minutes
	playtime_2weeks?: number;  // minutes, only present if played in last 2 weeks
	rtime_last_played: number; // Unix timestamp, 0 if never played
	img_icon_url: string;
};

type GetOwnedGamesResponse = {
	response: {
		game_count: number;
		games: SteamGame[];
	};
};

export type StoreDetails = {
	genres: string[];
	metacritic: number | null;
	releaseDate: string | null; // ISO "YYYY-MM-DD" or null if unknown/upcoming
};

export async function getSteamLibrary(apiKey: string, steamId: string): Promise<SteamGame[]> {
	const url = `${STEAM_API_URL}/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true&format=json`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Steam API failed (${res.status}): ${await res.text()}`);
	const data = (await res.json()) as GetOwnedGamesResponse;
	return data.response.games ?? [];
}

export async function getStoreDetails(appid: number): Promise<StoreDetails> {
	const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}`);
	const empty: StoreDetails = { genres: [], metacritic: null, releaseDate: null };
	if (!res.ok) return empty;
	const json = await res.json() as Record<string, { success: boolean; data?: any }>;
	const entry = json?.[String(appid)];
	if (!entry?.success || !entry.data) return empty;
	const d = entry.data;
	return {
		genres: (d.genres ?? []).map((g: { description: string }) => g.description),
		metacritic: d.metacritic?.score ?? null,
		releaseDate: parseSteamDate(d.release_date?.date ?? ""),
	};
}

function parseSteamDate(raw: string): string | null {
	if (!raw) return null;
	const lower = raw.toLowerCase();
	if (lower.includes("soon") || lower.includes("tbd") || lower.includes("tba") || lower.startsWith("q")) return null;
	// "Jul 9, 2013" or "January 23, 2020"
	const full = new Date(raw);
	if (!isNaN(full.getTime())) return full.toISOString().split("T")[0];
	// "June 2024" — no day specified, use first of month
	const monthYear = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
	if (monthYear) {
		const d = new Date(`${monthYear[1]} 1, ${monthYear[2]}`);
		if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
	}
	return null;
}

export function minutesToHours(minutes: number): number {
	return Math.round((minutes / 60) * 10) / 10;
}

export function getGameCoverUrl(appid: number): string {
	return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

export function getGameIconUrl(appid: number, imgIconUrl: string): string {
	return `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${imgIconUrl}.jpg`;
}
