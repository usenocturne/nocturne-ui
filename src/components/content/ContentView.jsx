import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useNavigation } from "../../hooks/useNavigation";
import { CarThingIcon } from "../common/icons";
import { useSpotifyPlayerState } from "../../hooks/useSpotifyPlayerState";
import { useButtonMapping } from "../../hooks/useButtonMapping";
import ButtonMappingOverlay from "../common/overlays/ButtonMappingOverlay";

const ContentView = ({
  accessToken,
  contentId,
  contentType = "album",
  onClose,
  onNavigateToNowPlaying,
  currentlyPlayingTrackUri,
  radioMixes = [],
  updateGradientColors,
  setIgnoreNextRelease,
}) => {
  const [content, setContent] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(-1);
  const tracksContainerRef = useRef(null);
  const navigate = useNavigate();
  const { currentPlayback } = useSpotifyPlayerState(accessToken);

  const {
    playTrack,
    isLoading: isPlaybackLoading,
    error: playbackError,
    toggleShuffle,
  } = useSpotifyPlayerControls(accessToken);

  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);

  const fetchPlaylistTracks = async (playlistId, initialTracks, initialNext) => {
    let allTracks = [...initialTracks];
    let nextUrl = initialNext;

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch additional tracks: ${response.status}`);
      }

      const data = await response.json();
      allTracks = [...allTracks, ...data.items.map(item => item.track)];
      nextUrl = data.next;
    }

    return allTracks;
  };

  const { showMappingOverlay, activeButton, mappingInProgress, setTrackUris } =
    useButtonMapping({
      accessToken,
      contentId,
      contentType,
      contentImage: content?.images?.[1]?.url || "",
      contentName: content?.name || "",
      playTrack,
      isActive: !!content,
      setIgnoreNextRelease,
    });

  useEffect(() => {
    if (
      tracks.length > 0 &&
      (contentType === "mix" || contentType === "liked-songs")
    ) {
      const trackUris = tracks
        .filter((track) => track && track.uri)
        .map((track) => track.uri);

      setTrackUris(trackUris);
    }
  }, [tracks, contentType, setTrackUris]);

  useEffect(() => {
    if (currentPlayback?.shuffle_state !== undefined) {
      setIsShuffleEnabled(currentPlayback.shuffle_state);
    }
  }, [currentPlayback?.shuffle_state]);

  const handleTrackSelect = (index, trackElement) => {
    if (index >= 0 && index < tracks.length) {
      handleTrackPlay(tracks[index], index);
    }
  };

  const { selectedIndex } = useNavigation({
    containerRef: tracksContainerRef,
    enableScrollTracking: true,
    enableWheelNavigation: true,
    enableKeyboardNavigation: true,
    enableItemSelection: true,
    enableEscapeKey: true,
    onEscape: handleBack,
    onItemSelect: handleTrackSelect,
    onItemFocus: (index) => setSelectedTrackIndex(index),
    inactivityTimeout: 3000,
    vertical: true,
  });

  useEffect(() => {
    const fetchContent = async () => {
      if (!accessToken) return;
      if (!contentId && contentType !== "liked-songs") return;

      try {
        setIsLoading(true);
        let contentData;
        let tracksData = [];

        switch (contentType) {
          case "album": {
            const albumResponse = await fetch(
              `https://api.spotify.com/v1/albums/${contentId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!albumResponse.ok) {
              throw new Error(
                `Failed to fetch album data: ${albumResponse.status}`
              );
            }

            contentData = await albumResponse.json();

            const albumTracksResponse = await fetch(
              `https://api.spotify.com/v1/albums/${contentId}/tracks?limit=50`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!albumTracksResponse.ok) {
              throw new Error(
                `Failed to fetch album tracks: ${albumTracksResponse.status}`
              );
            }

            tracksData = (await albumTracksResponse.json()).items;
            break;
          }

          case "artist": {
            const artistResponse = await fetch(
              `https://api.spotify.com/v1/artists/${contentId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!artistResponse.ok) {
              throw new Error(
                `Failed to fetch artist data: ${artistResponse.status}`
              );
            }

            contentData = await artistResponse.json();

            const artistTracksResponse = await fetch(
              `https://api.spotify.com/v1/artists/${contentId}/top-tracks?market=from_token`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!artistTracksResponse.ok) {
              throw new Error(
                `Failed to fetch artist tracks: ${artistTracksResponse.status}`
              );
            }

            tracksData = (await artistTracksResponse.json()).tracks;
            break;
          }

          case "playlist": {
            const playlistResponse = await fetch(
              `https://api.spotify.com/v1/playlists/${contentId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!playlistResponse.ok) {
              throw new Error(
                `Failed to fetch playlist data: ${playlistResponse.status}`
              );
            }

            contentData = await playlistResponse.json();
            const initialTracks = contentData.tracks.items.map((item) => item.track);
            tracksData = await fetchPlaylistTracks(contentId, initialTracks, contentData.tracks.next);
            break;
          }

          case "liked-songs": {
            const likedSongsResponse = await fetch(
              "https://api.spotify.com/v1/me/tracks?limit=50",
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!likedSongsResponse.ok) {
              throw new Error(
                `Failed to fetch liked songs: ${likedSongsResponse.status}`
              );
            }

            const likedSongsData = await likedSongsResponse.json();

            contentData = {
              id: "liked-songs",
              name: "Liked Songs",
              type: "liked-songs",
              images: [
                { url: "https://misc.scdn.co/liked-songs/liked-songs-300.png" },
              ],
              tracks: { total: likedSongsData.total },
              owner: { display_name: "You" },
            };

            tracksData = likedSongsData.items.map((item) => item.track);
            break;
          }

          case "mix": {
            const foundMix = radioMixes.find((m) => m.id === contentId);

            if (foundMix) {
              contentData = {
                ...foundMix,
                type: "mix",
              };

              tracksData = foundMix.tracks || [];
            } else {
              throw new Error(`Mix not found: ${contentId}`);
            }
            break;
          }

          default:
            throw new Error(`Unsupported content type: ${contentType}`);
        }

        setContent(contentData);
        setTracks(tracksData);

        if (
          contentData?.images &&
          contentData.images.length > 0 &&
          updateGradientColors
        ) {
          const imageUrl = (contentType === "artist" || contentType === "album") && contentData.images.length > 1
            ? contentData.images[1].url
            : contentData.images[0].url;
          updateGradientColors(imageUrl, contentType);
        }
      } catch (err) {
        console.error(`Error fetching ${contentType} data:`, err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchContent();
  }, [contentId, contentType, accessToken, radioMixes, updateGradientColors]);

  function handleBack() {
    if (onClose) {
      onClose();
    } else {
      navigate(-1);
    }
  }

  const handleTrackPlay = async (track, index) => {
    if (!track || !track.uri) {
      console.warn("Attempted to play an invalid track:", track);
      return;
    }

    let contextUri = null;
    let uris = null;
    let wasShuffleEnabled = isShuffleEnabled;

    if (contentType === "album") {
      contextUri = `spotify:album:${contentId}`;
    } else if (contentType === "playlist") {
      contextUri = `spotify:playlist:${contentId}`;
    } else if (contentType === "artist") {
      uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
      const startIndex = index || 0;
      uris = uris.slice(startIndex).concat(uris.slice(0, startIndex));
    } else if (contentType === "mix") {
      uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
      const startIndex = index || 0;
      uris = uris.slice(startIndex).concat(uris.slice(0, startIndex));

      localStorage.setItem("currentPlayingMixId", contentId);
    } else if (contentType === "liked-songs") {
      uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);

      if (wasShuffleEnabled) {
        await toggleShuffle(false);
      }

      const startIndex = index || 0;
      uris = uris.slice(startIndex).concat(uris.slice(0, startIndex));

      localStorage.setItem("playingLikedSongs", "true");
    }

    if (!contextUri && (!uris || uris.length === 0)) {
      console.warn("No valid context or URIs to play");
      return;
    }

    const success = contextUri
      ? await playTrack(track.uri, contextUri)
      : await playTrack(null, null, uris);

    if (success && contentType === "liked-songs" && wasShuffleEnabled) {
      setTimeout(async () => {
        await toggleShuffle(true);
      }, 500);
    }

    if (success && onNavigateToNowPlaying) {
      onNavigateToNowPlaying();
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 fadeIn-animation">
        <div className="md:w-1/3 sticky top-10">
          <div className="min-w-[280px] mr-10">
            <div className="aspect-square rounded-[12px] drop-shadow-xl bg-white/10 animate-pulse w-[280px] h-[280px]" />
            <div className="mt-4 h-10 bg-white/10 animate-pulse w-[250px] rounded" />
            <div className="mt-3 h-8 bg-white/10 animate-pulse w-[200px] rounded" />
          </div>
        </div>
        <div className="md:w-2/3 pl-20 h-[calc(100vh-5rem)]">
          {Array(5)
            .fill()
            .map((_, i) => (
              <div key={i} className="flex gap-12 items-start mb-4">
                <div className="w-6 h-8 bg-white/10 animate-pulse rounded" />
                <div className="flex-grow">
                  <div className="h-8 bg-white/10 animate-pulse w-[250px] rounded mb-2" />
                  <div className="h-6 bg-white/10 animate-pulse w-[200px] rounded" />
                </div>
              </div>
            ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[480px] text-white/70">
        <CarThingIcon className="h-16 w-auto mb-2" />
        <h3 className="text-[36px] font-[560] text-white truncate tracking-tight">
          Error Loading Content
        </h3>
        <p className="text-[24px] font-[560] text-white/60 truncate tracking-tight">
          {error}
        </p>
      </div>
    );
  }

  if (!content) {
    return null;
  }

  const getImageUrl = () => {
    if (!content.images || !content.images.length) {
      return "/images/not-playing.webp";
    }
    if ((contentType === "artist" || contentType === "album") && content.images.length > 1) {
      return content.images[1].url;
    }
    return content.images[0].url;
  };

  const getSubtitle = () => {
    switch (contentType) {
      case "album":
        return content.artists?.map((artist) => artist.name).join(", ");
      case "artist":
        return `${content.followers?.total?.toLocaleString() || 0} Followers`;
      case "playlist":
        return `${content.tracks?.total || 0} Songs`;
      case "liked-songs":
        return `${content.tracks?.total || 0} Songs`;
      case "mix":
        return `${content.tracks?.length || 0} Tracks`;
      default:
        return "";
    }
  };

  const getImageStyle = () => {
    return contentType === "artist"
      ? "aspect-square rounded-full drop-shadow-xl object-cover"
      : "aspect-square rounded-[12px] drop-shadow-xl";
  };

  const getMappingStatusText = () => {
    if (mappingInProgress) {
      return (
        <div className="absolute top-0 left-0 right-0 bg-black/80 text-white py-2 px-4 text-center rounded-t-[12px]">
          <span className="text-lg font-medium">Mapping to button...</span>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 fadeIn-animation">
      <div className="md:w-1/3 sticky top-10">
        <div className="min-w-[280px] mr-10 relative">
          <img
            src={getImageUrl()}
            alt={`${content.name} Cover`}
            width={280}
            height={280}
            className={getImageStyle()}
          />
          {getMappingStatusText()}
          <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
            {content.name}
          </h4>
          <h4 className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
            {getSubtitle()}
          </h4>
        </div>
      </div>

      <div
        className="md:w-2/3 pl-20 h-[calc(100vh-5rem)] overflow-y-auto scroll-container scroll-smooth pb-12"
        ref={tracksContainerRef}
      >
        {tracks.map((track, index) => {
          if (!track) return null;

          return (
            <div
              key={track.id || `track-${index}`}
              className={`flex gap-12 items-start mb-4 transition-transform duration-200 ease-out ${selectedTrackIndex === index ? "scale-105" : ""
                }`}
              onClick={() => (track.uri ? handleTrackPlay(track, index) : null)}
              style={{ transition: "transform 0.2s ease-out" }}
              data-track-index={index}
            >
              <div className="text-[32px] font-[580] text-center text-white/60 w-6 mt-3">
                {track.uri && track.uri === currentlyPlayingTrackUri ? (
                  <div className="w-5">
                    <section>
                      <div className="wave0"></div>
                      <div className="wave1"></div>
                      <div className="wave2"></div>
                      <div className="wave3"></div>
                    </section>
                  </div>
                ) : (
                  <p>{index + 1}</p>
                )}
              </div>

              <div className="flex-grow">
                <div>
                  <p className="text-[32px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                    {track.name || "Unknown Track"}
                  </p>
                </div>
                <div className="flex flex-wrap">
                  {track.artists &&
                    track.artists.map((artist, artistIndex) => (
                      <p
                        key={artist?.id || `artist-${artistIndex}`}
                        className={`text-[28px] font-[560] text-white/60 truncate tracking-tight ${artistIndex < track.artists.length - 1
                            ? 'mr-2 after:content-[","]'
                            : ""
                          }`}
                      >
                        {artist?.name === null && artist?.type
                          ? artist.type
                          : artist?.name || "Unknown Artist"}
                      </p>
                    ))}
                </div>
              </div>
            </div>
          );
        })}

        {playbackError && (
          <div className="mt-4 p-4 bg-red-500/20 rounded-lg">
            <p className="text-white/80">{playbackError}</p>
          </div>
        )}
      </div>

      <ButtonMappingOverlay
        show={showMappingOverlay}
        activeButton={activeButton}
      />
    </div>
  );
};

export default ContentView;
