const IGDB_URL = "https://api.igdb.com/v4";
const IGDB_CLIENT_ID = "t74qox39mvrdtvn6kxi99zu5trccdz";

type igdbSearchResponse = Array<{
    id: string;
    artworks: Array<number>;
    cover: number;
}>;

type videoGameDetails = {
  id: string;
  icon: string;
  cover: string;
};

export async function getAuthToken(igdb_token: string): Promise<string> {
    const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${IGDB_CLIENT_ID}&client_secret=${igdb_token}&grant_type=client_credentials`, {
        method: "POST",
    });

    if (!res.ok) throw new Error(`IGDB login failed (${res.status}): ${await res.text()}`);

    const json = (await res.json());

    return json.access_token;
}

export async function searchVideoGame(igdb_token: string, game_name: string, year: any = "",): Promise<videoGameDetails> {
    const res = await fetch(`${IGDB_URL}/games`, {
        method: "POST",
        headers: {
            "Client-ID": IGDB_CLIENT_ID,
            "Authorization": `Bearer ${igdb_token}`,
        },
		body: `search "${game_name}"; fields *; limit 1;`,
    });

    if (!res.ok) throw new Error(`IGDB search failed (${res.status}): ${await res.text()}`);

    const json = (await res.json()) as igdbSearchResponse;

    const data = {
        "id": json[0].id,
        "icon": "",
        "cover": "",
    };
    if (json[0].artworks.length > 0) {
        data["icon"] = <string>await getVideoGameIcon(igdb_token, json[0].artworks[0]);
    }
    if (json[0].cover) {
        data["cover"] = <string>await getVideoGameCover(igdb_token, json[0].cover);
    }
    console.log(data);

    return data;
}

async function getVideoGameIcon(igdb_token: string, artwork_id: number): Promise<string | null> {
    const res = await fetch(`${IGDB_URL}/artworks`, {
        method: "POST",
        headers: {
            "Client-ID": IGDB_CLIENT_ID,
            "Authorization": `Bearer ${igdb_token}`,
        },
		body: `fields *; where id = ${artwork_id}; limit 1;`,
    });

    if (!res.ok) throw new Error(`IGDB get artwork failed (${res.status}): ${await res.text()}`);

    const json = (await res.json());
    console.log(`Icon response: ${JSON.stringify(json)}`);

    return `https:${json[0].url}`;
}

async function getVideoGameCover(igdb_token: string, cover_id: number): Promise<string | null> {
    const res = await fetch(`${IGDB_URL}/covers`, {
        method: "POST",
        headers: {
            "Client-ID": IGDB_CLIENT_ID,
            "Authorization": `Bearer ${igdb_token}`,
        },
		body: `fields *; where id = ${cover_id}; limit 1;`,
    });

    if (!res.ok) throw new Error(`IGDB get cover failed (${res.status}): ${await res.text()}`);

    const json = (await res.json());
    console.log(`Cover response: ${JSON.stringify(json)}`);

    return `https:${json[0].url.replace("t_thumb", "t_original")}`;
}
