import { XMLParser } from "fast-xml-parser";

const BGG_BASE = "https://boardgamegeek.com/xmlapi2";

export async function find_game(bgg_token: string, game_name: string) {
  type Item = {
    "@_type": string,
    "@_id": number,
  };

  const response = await fetch(`${BGG_BASE}/search?query=${game_name}&type=boardgame&exact=1`, {
    method: "GET",
    headers: {"Authorization": `Bearer ${bgg_token}`},
  });

  if (!response.ok) throw new Error(`BGG Search failed (${response.status}): ${await response.text()}`);
  const initial_response = await response.text();

  const search_parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (_tagName, jPath) => jPath === "items.item",
  });
  const search_result = search_parser.parse(initial_response) as { items: { item: Item[] } };

  if (search_result.items.item.length > 0) {
    return search_result.items.item[0]["@_id"];
  } else {
    throw new Error("Unable to locate game in search!");
  }
}

export async function get_game_details(bgg_token: string, game_id: number) {
  type player_count = {
    "@_value": string,
  }

  type value = {
    "@_value": string,
  }

  type rating = {
    average: value,
  }

  type item_details = {
    "@_type": string,
    "@_id": number,
    image: string,
    minplayers: player_count,
    maxplayers: player_count,
    statistics: {
      ratings: rating,
    },
  }

  const response = await fetch(`${BGG_BASE}/thing?id=${game_id}&type=boardgame&stats=1`, {
    method: "GET",
    headers: {"Authorization": `Bearer ${bgg_token}`},
  });
  if (!response.ok) throw new Error(`BGG Detail lookup failed (${response.status}): ${await response.text()}`);
  const secondary_response = await response.text();

  const details_parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (_tagName, jPath) => jPath === "items.item",
  });
  const details_result = details_parser.parse(secondary_response) as { items: { item: item_details[] } };

  if (details_result.items.item.length > 0) {
    return {
      image: details_result.items.item[0].image,
      players: {
        min: details_result.items.item[0].minplayers["@_value"],
        max: details_result.items.item[0].maxplayers["@_value"],
      },
      rating: details_result.items.item[0].statistics.ratings.average["@_value"],
    }
  } else {
    throw new Error("Unable to locate game details!");
  }
}
