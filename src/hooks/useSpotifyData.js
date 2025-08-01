import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "./useAuth";
import { useSpotifyPlayerState } from "./useSpotifyPlayerState";
import { useSpotifyPlayerControls } from "./useSpotifyPlayerControls";
import {
  networkAwareRequest,
  waitForNetwork,
} from "../utils/networkAwareRequest";
import { getCachedTimezone } from "../components/common/navigation/StatusBar";

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

export function useSpotifyData(
  activeSection,
  skipInitialFetch = false,
  tokenReady = true,
) {
  const {
    isAuthenticated,
    accessToken,
    isLoading: authIsLoading,
    refreshTokens,
    error: authError,
  } = useAuth();

  const [isInitializing, setIsInitializing] = useState(false);
  const [recentAlbums, setRecentAlbums] = useState([]);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [topArtists, setTopArtists] = useState([]);
  const [likedSongs, setLikedSongs] = useState({
    name: "Liked Songs",
    tracks: { total: 0 },
    images: [{ url: "https://misc.scdn.co/liked-songs/liked-songs-300.png" }],
    type: "liked-songs",
  });
  const [radioMixes, setRadioMixes] = useState([]);
  const [userShows, setUserShows] = useState([]);
  const [retryCount, setRetryCount] = useState(0);

  const [isLoading, setIsLoading] = useState({
    recentAlbums: true,
    userPlaylists: true,
    topArtists: true,
    likedSongs: true,
    radioMixes: true,
    userShows: true,
  });

  const [errors, setErrors] = useState({
    recentAlbums: null,
    userPlaylists: null,
    topArtists: null,
    likedSongs: null,
    radioMixes: null,
    userShows: null,
  });

  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const dataLoadingAttemptedRef = useRef(false);
  const initialLoadTriggeredRef = useRef(false);
  const dataFetchingInProgressRef = useRef(false);
  const lastPlayedAlbumIdRef = useRef(null);
  const effectiveToken = useMemo(() => {
    return tokenReady && isAuthenticated && !isInitializing && accessToken
      ? accessToken
      : null;
  }, [tokenReady, isAuthenticated, isInitializing, accessToken]);
  const retryTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  const {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    isLoading: playerIsLoading,
    error: playerError,
    refreshPlaybackState,
  } = useSpotifyPlayerState(effectiveToken, !isInitializing);

  const playerControls = useSpotifyPlayerControls(effectiveToken);

  useEffect(() => {
    if (skipInitialFetch) return;
    if (isAuthenticated && !authIsLoading && !initialDataLoaded) {
      loadInitialData();
    }
  }, [isAuthenticated, authIsLoading, skipInitialFetch]);

  useEffect(() => {
    if (currentlyPlayingAlbum?.id) {
      if (
        !recentAlbums.length ||
        recentAlbums[0]?.id !== currentlyPlayingAlbum.id
      ) {
        lastPlayedAlbumIdRef.current = currentlyPlayingAlbum.id;
        setRecentAlbums((prevAlbums) => {
          const filteredAlbums = prevAlbums.filter(
            (album) => album.id !== currentlyPlayingAlbum.id,
          );
          return [currentlyPlayingAlbum, ...filteredAlbums].slice(0, 50);
        });

        if (activeSection === "recents") {
          setTimeout(() => {
            const event = new CustomEvent("albumOrderChanged", {
              detail: { albumId: currentlyPlayingAlbum.id },
            });
            window.dispatchEvent(event);
          }, 50);
        }
      }
    }
  }, [currentlyPlayingAlbum, recentAlbums, activeSection]);

  const fetchRecentlyPlayed = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, recentAlbums: true }));

      const response = await networkAwareRequest(() =>
        fetch(
          "https://api.spotify.com/v1/me/player/recently-played?limit=50&additional_types=track,episode",
          {
            headers: {
              Authorization: `Bearer ${effectiveToken}`,
            },
          },
        ),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const uniqueAlbums = [];
      const albumIds = new Set();

      if (currentlyPlayingAlbum?.id) {
        albumIds.add(currentlyPlayingAlbum.id);
        uniqueAlbums.push(currentlyPlayingAlbum);
      }

      data.items.forEach((item) => {
        if (
          item.track &&
          item.track.type === "track" &&
          item.track.album &&
          !albumIds.has(item.track.album.id)
        ) {
          albumIds.add(item.track.album.id);
          uniqueAlbums.push(item.track.album);
        } else if (
          item.track &&
          item.track.type === "episode" &&
          item.track.show &&
          !albumIds.has(item.track.show.id)
        ) {
          albumIds.add(item.track.show.id);
          uniqueAlbums.push(item.track.show);
        }
      });

      setRecentAlbums(uniqueAlbums);
      setErrors((prev) => ({ ...prev, recentAlbums: null }));
      return uniqueAlbums;
    } catch (err) {
      console.error("Error fetching recently played:", err);
      setErrors((prev) => ({ ...prev, recentAlbums: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, recentAlbums: false }));
    }
  }, [effectiveToken, currentlyPlayingAlbum]);

  const fetchUserPlaylists = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, userPlaylists: true }));

      const response = await networkAwareRequest(() =>
        fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setUserPlaylists(data.items);
      setErrors((prev) => ({ ...prev, userPlaylists: null }));
      return data.items;
    } catch (err) {
      console.error("Error fetching user playlists:", err);
      setErrors((prev) => ({ ...prev, userPlaylists: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, userPlaylists: false }));
    }
  }, [effectiveToken]);

  const fetchTopArtists = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, topArtists: true }));

      const response = await networkAwareRequest(() =>
        fetch("https://api.spotify.com/v1/me/top/artists?limit=50", {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setTopArtists(data.items);
      setErrors((prev) => ({ ...prev, topArtists: null }));
      return data.items;
    } catch (err) {
      console.error("Error fetching top artists:", err);
      setErrors((prev) => ({ ...prev, topArtists: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, topArtists: false }));
    }
  }, [effectiveToken]);

  const fetchLikedSongs = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, likedSongs: true }));

      const response = await networkAwareRequest(() =>
        fetch("https://api.spotify.com/v1/me/tracks?limit=1", {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const updatedLikedSongs = {
        ...likedSongs,
        tracks: { total: data.total },
      };
      setLikedSongs(updatedLikedSongs);
      setErrors((prev) => ({ ...prev, likedSongs: null }));
      return updatedLikedSongs;
    } catch (err) {
      console.error("Error fetching liked songs:", err);
      setErrors((prev) => ({ ...prev, likedSongs: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, likedSongs: false }));
    }
  }, [effectiveToken, likedSongs]);

  const fetchUserShows = useCallback(async () => {
    if (!effectiveToken) return;

    try {
      setIsLoading((prev) => ({ ...prev, userShows: true }));

      const response = await networkAwareRequest(() =>
        fetch("https://api.spotify.com/v1/me/shows?limit=50", {
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
        }),
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setUserShows(data.items || []);
      setErrors((prev) => ({ ...prev, userShows: null }));
      return data.items || [];
    } catch (err) {
      console.error("Error fetching user shows:", err);
      setErrors((prev) => ({ ...prev, userShows: err.message }));
      throw err;
    } finally {
      setIsLoading((prev) => ({ ...prev, userShows: false }));
    }
  }, [effectiveToken]);

  const fetchRadioMixes = useCallback(async () => {
    if (!effectiveToken) return;

    let spotifyMixes = [];

    try {
      setIsLoading((prev) => ({ ...prev, radioMixes: true }));

      let userTimezone = "America/New_York";

      const maxWaitTime = 5000;
      const checkInterval = 100;
      let waitTime = 0;

      while (waitTime < maxWaitTime) {
        const cachedTz = getCachedTimezone();
        if (cachedTz) {
          userTimezone = cachedTz;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
        waitTime += checkInterval;
      }

      const [
        topTracksMediumTerm,
        topTracksLongTerm,
        recentlyPlayed,
        topArtists,
        spotifyRadioMixesResponse,
      ] = await Promise.all([
        networkAwareRequest(() =>
          fetch(
            "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term",
            {
              headers: { Authorization: `Bearer ${effectiveToken}` },
            },
          ),
        ).then((res) => (res.ok ? res.json() : { items: [] })),
        networkAwareRequest(() =>
          fetch(
            "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term",
            {
              headers: { Authorization: `Bearer ${effectiveToken}` },
            },
          ),
        ).then((res) => (res.ok ? res.json() : { items: [] })),
        networkAwareRequest(() =>
          fetch(
            "https://api.spotify.com/v1/me/player/recently-played?limit=50",
            {
              headers: { Authorization: `Bearer ${effectiveToken}` },
            },
          ),
        ).then((res) => (res.ok ? res.json() : { items: [] })),
        networkAwareRequest(() =>
          fetch("https://api.spotify.com/v1/me/top/artists?limit=10", {
            headers: { Authorization: `Bearer ${effectiveToken}` },
          }),
        ).then((res) => (res.ok ? res.json() : { items: [] })),

        networkAwareRequest(() =>
          fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
            method: "POST",
            headers: {
              authorization: `Bearer ${effectiveToken}`,
              "content-type": "application/json;charset=UTF-8",
            },
            body: JSON.stringify({
              variables: {
                uri: "spotify:section:0JQ5DAUnp4wcj0bCb3wh3S",
                timeZone: userTimezone,
                sp_t: "",
                sectionItemsOffset: 0,
                sectionItemsLimit: 20,
              },
              operationName: "homeSection",
              extensions: {
                persistedQuery: {
                  version: 1,
                  sha256Hash:
                    "c11ff5d8f508cb1a3dad3f15ee80611cda7df7e6fb45212e466fb3e84a680bf9",
                },
              },
            }),
          }),
        )
          .then((res) => {
            if (res.ok) {
              return res.json();
            }
            return { data: { homeSections: { sections: [] } } };
          })
          .catch((err) => {
            console.warn("Failed to fetch Spotify radio mixes:", err);
            return { data: { homeSections: { sections: [] } } };
          }),
      ]);

      const mixes = [];

      if (
        spotifyRadioMixesResponse?.data?.homeSections?.sections?.[0]
          ?.sectionItems?.items
      ) {
        const spotifyItems =
          spotifyRadioMixesResponse.data.homeSections.sections[0].sectionItems
            .items;

        const spotifyMixPromises = spotifyItems.map(async (item, index) => {
          if (
            item.content?.__typename === "PlaylistResponseWrapper" &&
            item.content?.data?.__typename === "Playlist"
          ) {
            const playlist = item.content.data;

            if (playlist.uri === "spotify:playlist:37i9dQZF1EYkqdzj48dyYq") {
              return null;
            }

            let tracks = [];

            try {
              const playlistResponse = await networkAwareRequest(() =>
                fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
                  method: "POST",
                  headers: {
                    authorization: `Bearer ${effectiveToken}`,
                    "content-type": "application/json;charset=UTF-8",
                  },
                  body: JSON.stringify({
                    variables: {
                      uri: playlist.uri,
                      offset: 0,
                      limit: 25,
                      enableWatchFeedEntrypoint: true,
                    },
                    operationName: "fetchPlaylist",
                    extensions: {
                      persistedQuery: {
                        version: 1,
                        sha256Hash:
                          "cd2275433b29f7316176e7b5b5e098ae7744724e1a52d63549c76636b3257749",
                      },
                    },
                  }),
                }),
              );

              if (playlistResponse.ok) {
                const playlistData = await playlistResponse.json();

                if (playlistData?.data?.playlistV2?.content?.items) {
                  tracks = playlistData.data.playlistV2.content.items
                    .filter(
                      (item) =>
                        item.itemV2?.__typename === "TrackResponseWrapper" &&
                        item.itemV2?.data,
                    )
                    .map((item, trackIndex) => {
                      const track = item.itemV2.data;
                      return {
                        id: track.uri.replace("spotify:track:", ""),
                        name: track.name,
                        uri: track.uri,
                        uniqueId: `${playlist.uri.replace("spotify:playlist:", "spotify-")}-${track.uri.replace("spotify:track:", "")}`,
                        artists:
                          track.artists?.items?.map((artist) => ({
                            id: artist.uri.replace("spotify:artist:", ""),
                            name: artist.profile?.name || "Unknown Artist",
                            uri: artist.uri,
                          })) || [],
                        album: {
                          id:
                            track.albumOfTrack?.uri?.replace(
                              "spotify:album:",
                              "",
                            ) || "",
                          name: track.albumOfTrack?.name || "Unknown Album",
                          uri: track.albumOfTrack?.uri || "",
                        },
                      };
                    });
                }
              }
            } catch (error) {
              console.warn(
                `Failed to fetch tracks for playlist ${playlist.uri}:`,
                error,
              );
            }

            const spotifyMix = {
              id: playlist.uri.replace("spotify:playlist:", "spotify-"),
              name: playlist.name,
              images: playlist.images?.items?.[0]?.sources
                ? [{ url: playlist.images.items[0].sources[0].url }]
                : [{ url: "/images/radio-cover/discoveries.webp" }],
              tracks: tracks,
              type: "spotify-radio",
              uri: playlist.uri,
              description: playlist.description,
              format: playlist.format,
              sortOrder: 100 + index,
              extractedColors: playlist.images?.items?.[0]?.extractedColors,
            };

            return spotifyMix;
          }
          return null;
        });

        const resolvedSpotifyMixes = await Promise.all(spotifyMixPromises);
        spotifyMixes.push(
          ...resolvedSpotifyMixes.filter((mix) => mix !== null),
        );
      }

      const getUniqueTracksById = (tracks) => {
        const uniqueMap = new Map();
        tracks.forEach((track) => {
          if (!uniqueMap.has(track.id)) {
            uniqueMap.set(track.id, track);
          }
        });
        return Array.from(uniqueMap.values());
      };

      const addUniqueIds = (tracks, mixId) => {
        return tracks.map((track) => ({
          ...track,
          uniqueId: `${mixId}-${track.id}`,
        }));
      };

      if (topTracksMediumTerm.items && topTracksMediumTerm.items.length > 0) {
        mixes.push({
          id: "top-mix",
          name: "Your Top Mix",
          images: [{ url: "/images/radio-cover/top.webp" }],
          tracks: addUniqueIds(topTracksMediumTerm.items, "top-mix"),
          type: "static",
          sortOrder: 1,
        });
      }

      if (topArtists.items && topArtists.items.length > 0) {
        const artistsToFetch = topArtists.items.slice(0, 5);

        const artistTracksPromises = artistsToFetch.map((artist) =>
          networkAwareRequest(() =>
            fetch(
              `https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=US`,
              {
                headers: {
                  Authorization: `Bearer ${effectiveToken}`,
                },
              },
            ),
          ).then((res) => (res.ok ? res.json() : { tracks: [] })),
        );

        const artistTracksResponses = await Promise.all(artistTracksPromises);

        const allArtistTracks = artistTracksResponses.flatMap(
          (response) => response.tracks || [],
        );

        const uniqueArtistTracks = getUniqueTracksById(allArtistTracks)
          .sort(() => Math.random() - 0.5)
          .slice(0, 50);

        if (uniqueArtistTracks.length > 0) {
          mixes.push({
            id: "discoveries-mix",
            name: "Discoveries",
            images: [{ url: "/images/radio-cover/discoveries.webp" }],
            tracks: addUniqueIds(uniqueArtistTracks, "discoveries-mix"),
            type: "static",
            sortOrder: 2,
          });
        }
      }

      const allMixes = [...mixes, ...spotifyMixes];
      const sortedMixes = allMixes.sort((a, b) => a.sortOrder - b.sortOrder);

      setRadioMixes(sortedMixes);
      setErrors((prev) => ({ ...prev, radioMixes: null }));
      return sortedMixes;
    } catch (err) {
      console.error("Error fetching radio mixes:", err);
      setErrors((prev) => ({ ...prev, radioMixes: err.message }));

      const fallbackMixes = [
        {
          id: "top-mix",
          name: "Your Top Mix",
          images: [{ url: "/images/radio-cover/top.webp" }],
          tracks: [],
          type: "static",
          sortOrder: 1,
        },
        {
          id: "discoveries-mix",
          name: "Discoveries",
          images: [{ url: "/images/radio-cover/discoveries.webp" }],
          tracks: [],
          type: "static",
          sortOrder: 2,
        },
        ...spotifyMixes,
      ];

      setRadioMixes(fallbackMixes);
      return fallbackMixes;
    } finally {
      setIsLoading((prev) => ({ ...prev, radioMixes: false }));
    }
  }, [effectiveToken]);

  const isTokenValid = useCallback(() => {
    const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");
    if (!tokenExpiry) return false;

    const expiryTime = new Date(tokenExpiry);
    const now = new Date();
    const tenMinutes = 10 * 60 * 1000;
    return expiryTime.getTime() - now.getTime() > tenMinutes;
  }, []);

  const waitForValidToken = useCallback(async () => {
    if (!isAuthenticated || !accessToken) return false;
    if (isTokenValid()) return true;

    try {
      await refreshTokens();
      return isTokenValid();
    } catch (error) {
      console.error("Error refreshing token:", error);
      return false;
    }
  }, [isAuthenticated, accessToken, refreshTokens, isTokenValid]);

  const loadInitialData = useCallback(async () => {
    if (skipInitialFetch) return;
    if (
      initialLoadTriggeredRef.current ||
      !accessToken ||
      isInitializing ||
      initialDataLoaded ||
      dataLoadingAttemptedRef.current ||
      dataFetchingInProgressRef.current
    ) {
      return;
    }

    initialLoadTriggeredRef.current = true;

    const hasValidToken = await waitForValidToken();
    if (!hasValidToken) {
      return;
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    dataLoadingAttemptedRef.current = true;
    dataFetchingInProgressRef.current = true;
    console.log("Starting initial data load...");

    setIsLoading({
      recentAlbums: true,
      userPlaylists: true,
      topArtists: true,
      likedSongs: true,
      radioMixes: true,
      userShows: true,
    });

    try {
      await waitForNetwork();

      abortControllerRef.current = new AbortController();

      const results = await Promise.allSettled([
        fetchRecentlyPlayed(),
        fetchUserPlaylists(),
        fetchTopArtists(),
        fetchLikedSongs(),
        fetchRadioMixes(),
        fetchUserShows(),
      ]);

      const failedRequests = results.filter(
        (result) => result.status === "rejected",
      );

      if (failedRequests.length > 0) {
        console.error(
          "Some data fetching operations failed:",
          failedRequests.map((f) => f.reason),
        );

        if (retryCount < MAX_RETRIES) {
          setRetryCount((prev) => prev + 1);
          retryTimeoutRef.current = setTimeout(
            () => {
              dataLoadingAttemptedRef.current = false;
              dataFetchingInProgressRef.current = false;
              loadInitialData();
            },
            RETRY_DELAY * Math.pow(2, retryCount),
          );
          return;
        }
      }

      setInitialDataLoaded(true);
      setRetryCount(0);
      dataFetchingInProgressRef.current = false;
    } catch (error) {
      console.error("Error loading initial data:", error);

      if (retryCount < MAX_RETRIES) {
        setRetryCount((prev) => prev + 1);
        retryTimeoutRef.current = setTimeout(
          () => {
            dataLoadingAttemptedRef.current = false;
            dataFetchingInProgressRef.current = false;
            loadInitialData();
          },
          RETRY_DELAY * Math.pow(2, retryCount),
        );
      } else {
        dataFetchingInProgressRef.current = false;
      }
    }
  }, [
    accessToken,
    isInitializing,
    initialDataLoaded,
    retryCount,
    fetchRecentlyPlayed,
    fetchUserPlaylists,
    fetchTopArtists,
    fetchLikedSongs,
    fetchRadioMixes,
    fetchUserShows,
    skipInitialFetch,
  ]);

  useEffect(() => {
    if (skipInitialFetch) return;
    if (accessToken && !initialDataLoaded && !isInitializing) {
      loadInitialData();
    }

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [
    accessToken,
    initialDataLoaded,
    isInitializing,
    loadInitialData,
    skipInitialFetch,
  ]);

  const refreshData = useCallback(async () => {
    if (!accessToken) return;

    if (dataFetchingInProgressRef.current) {
      console.log("Skipping refresh - data fetching already in progress");
      return;
    }

    const hasValidToken = await waitForValidToken();
    if (!hasValidToken) {
      return;
    }

    dataFetchingInProgressRef.current = true;
    console.log("Starting data refresh...");

    setIsLoading((prev) => ({
      ...prev,
      userPlaylists: true,
      topArtists: true,
      likedSongs: true,
      radioMixes: true,
      userShows: true,
    }));

    try {
      await fetchUserPlaylists();
      await fetchTopArtists();
      await fetchLikedSongs();
      await fetchRadioMixes();
      await fetchUserShows();
    } catch (error) {
      console.error("Error refreshing data:", error);
    } finally {
      dataFetchingInProgressRef.current = false;
    }
  }, [
    accessToken,
    waitForValidToken,
    fetchUserPlaylists,
    fetchTopArtists,
    fetchLikedSongs,
    fetchRadioMixes,
    fetchUserShows,
    initialDataLoaded,
  ]);

  const isLoadingData = Object.values(isLoading).some(Boolean);
  const isLoadingAll =
    authIsLoading || isInitializing || isLoadingData || playerIsLoading;

  return {
    isAuthenticated,
    accessToken,
    authIsLoading,
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    playerIsLoading,
    playerError,
    refreshPlaybackState,
    playerControls,
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    radioMixes,
    userShows,
    initialDataLoaded,
    isLoading: {
      data: isLoadingData,
      player: playerIsLoading,
      auth: authIsLoading || isInitializing,
      all: isLoadingAll,
      recentAlbums: isLoading.recentAlbums,
      userPlaylists: isLoading.userPlaylists,
      topArtists: isLoading.topArtists,
      likedSongs: isLoading.likedSongs,
      radioMixes: isLoading.radioMixes,
      userShows: isLoading.userShows,
    },
    errors,
    refreshData,
    refreshRecentlyPlayed: fetchRecentlyPlayed,
    refreshUserPlaylists: fetchUserPlaylists,
    refreshTopArtists: fetchTopArtists,
    refreshLikedSongs: fetchLikedSongs,
    refreshRadioMixes: fetchRadioMixes,
    refreshUserShows: fetchUserShows,
  };
}
