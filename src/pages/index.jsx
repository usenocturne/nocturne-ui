import Sidebar from "../components/Sidebar";
import Settings from "../components/Settings";
import LongPressLink from "../components/LongPressLink";
import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { fetchLikedSongs } from "../services/playlistService";
import DonationQRModal from "../components/DonationQRModal";
import { useRouter } from "next/router";

export default function Home({
  accessToken,
  playlists,
  artists,
  radio,
  activeSection,
  setActiveSection,
  loading,
  albumsQueue,
  updateGradientColors,
  currentlyPlayingAlbum,
  showBrightnessOverlay,
  handleError,
}) {
  const router = useRouter();
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [focusedItemIndex, setFocusedItemIndex] = useState(-1);
  const [hasScrolled, setHasScrolled] = useState(false);
  const isFirstScrollRef = useRef(true);
  const unfocusTimeoutRef = useRef(null);

  const getCurrentItems = () => {
    switch (activeSection) {
      case "recents":
        return albumsQueue;
      case "library":
        return [
          {
            ...likedSongs,
            id: "liked-songs",
            images: [
              { url: "https://misc.scdn.co/liked-songs/liked-songs-640.png" },
            ],
          },
          ...playlists,
        ];
      case "artists":
        return artists;
      case "radio":
        return radio;
      default:
        return [];
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && focusedItemIndex >= 0) {
      e.preventDefault();
      const items = getCurrentItems();
      const item = items[focusedItemIndex];

      if (item) {
        let type =
          activeSection === "recents"
            ? "album"
            : activeSection === "artists"
            ? "artist"
            : "playlist";
        router.push({
          pathname: `/${type}/${item.id}`,
          query: { accessToken },
        });
      }
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleKeyPress);
    return () => {
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, [focusedItemIndex, activeSection]);

  useEffect(() => {
    if (activeSection === "radio") {
      updateGradientColors(null, "radio");
    } else if (activeSection === "library" && playlists.length > 0) {
      updateGradientColors(null, "library");
    } else if (activeSection === "artists" && artists.length > 0) {
      const firstArtistImage = artists[0]?.images?.[0]?.url;
      updateGradientColors(firstArtistImage || null, "artists");
    } else if (activeSection === "recents" && albumsQueue.length > 0) {
      const firstAlbumImage = albumsQueue[0]?.images?.[0]?.url;
      updateGradientColors(firstAlbumImage || null, "recents");
    } else if (activeSection === "settings") {
      const firstAlbumImage = albumsQueue[0]?.images?.[0]?.url;
      updateGradientColors(firstAlbumImage || null, "recents");
    }
  }, [activeSection, updateGradientColors, playlists, artists, albumsQueue]);

  const scrollContainerRef = useRef(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef(null);
  const prevQueueLengthRef = useRef(albumsQueue.length);
  const itemWidth = 290;
  const [likedSongs, setLikedSongs] = useState({
    name: "Liked Songs",
    tracks: { total: 0 },
    external_urls: {
      spotify: "https://open.spotify.com/collection/tracks",
    },
  });

  const calculateFocusedItem = useCallback(
    (scrollLeft) => {
      const itemTotalWidth = itemWidth + 40;
      const index = Math.round(scrollLeft / itemTotalWidth);
      return Math.max(0, index);
    },
    [itemWidth]
  );

  const handleWheel = useCallback(
    (e) => {
      if (!showBrightnessOverlay) {
        e.preventDefault();

        if (unfocusTimeoutRef.current) {
          clearTimeout(unfocusTimeoutRef.current);
        }

        if (isFirstScrollRef.current) {
          setHasScrolled(true);
          setFocusedItemIndex(0);
          isFirstScrollRef.current = false;

          unfocusTimeoutRef.current = setTimeout(() => {
            setFocusedItemIndex(-1);
          }, 2000);

          return;
        }

        if (scrollContainerRef.current) {
          const itemTotalWidth = itemWidth + 40;
          const direction = Math.sign(e.deltaX);
          const currentScrollLeft = scrollContainerRef.current.scrollLeft;
          const currentIndex = Math.round(currentScrollLeft / itemTotalWidth);
          const nextIndex = Math.max(0, currentIndex + direction);
          const targetScrollLeft = nextIndex * itemTotalWidth;

          setFocusedItemIndex(nextIndex);
          setHasScrolled(true);

          scrollContainerRef.current.style.scrollBehavior = "smooth";
          scrollContainerRef.current.scrollTo({
            left: targetScrollLeft,
            behavior: "smooth",
          });

          setTimeout(() => {
            scrollContainerRef.current.style.scrollBehavior = "auto";
          }, 500);

          unfocusTimeoutRef.current = setTimeout(() => {
            setFocusedItemIndex(-1);
          }, 2000);
        }
      }
    },
    [showBrightnessOverlay]
  );

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("wheel", handleWheel, {
        passive: false,
      });
    }

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("wheel", handleWheel);
      }
    };
  }, [handleWheel]);

  const handleScroll = useCallback(() => {
    if (isFirstScrollRef.current) {
      return;
    }

    setIsScrolling(true);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    if (unfocusTimeoutRef.current) {
      clearTimeout(unfocusTimeoutRef.current);
    }

    if (scrollContainerRef.current) {
      const newFocusedIndex = calculateFocusedItem(
        scrollContainerRef.current.scrollLeft
      );
      setFocusedItemIndex(newFocusedIndex);

      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 150);

      unfocusTimeoutRef.current = setTimeout(() => {
        setFocusedItemIndex(-1);
      }, 2000);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (unfocusTimeoutRef.current) {
        clearTimeout(unfocusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      scrollContainerRef.current &&
      activeSection === "recents" &&
      albumsQueue.length !== prevQueueLengthRef.current
    ) {
      scrollContainerRef.current.scrollTo({
        left: 0,
        behavior: "smooth",
      });
      setFocusedItemIndex(-1);
      setHasScrolled(false);
      isFirstScrollRef.current = true;
    }

    prevQueueLengthRef.current = albumsQueue.length;
  }, [albumsQueue, activeSection]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setFocusedItemIndex(-1);
    setHasScrolled(false);
    isFirstScrollRef.current = true;
  }, [activeSection]);

  useEffect(() => {
    if (accessToken) {
      fetchLikedSongs(accessToken, handleError).then((liked) => {
        if (liked) {
          setLikedSongs(liked);
        }
      });
    }
  }, [accessToken]);

  const renderItem = (item, index, type) => {
    const isScaled = hasScrolled && focusedItemIndex === index;
    const scaleClass = isScaled ? "scale-110" : "scale-100";

    return (
      <div
        key={item.id}
        className={`min-w-[280px] mr-10 snap-center transition-all duration-300 origin-center ${scaleClass}`}
      >
        <LongPressLink
          href={{
            pathname: `/${type}/${item.id}`,
            query: { accessToken },
          }}
          spotifyUrl={item?.external_urls?.spotify}
          accessToken={accessToken}
        >
          <Image
            src={item?.images?.[0]?.url || "/images/not-playing.webp"}
            alt={`${type} Cover`}
            width={280}
            height={280}
            className={`mt-10 aspect-square ${
              type === "artist" ? "rounded-full" : "rounded-[12px]"
            } drop-shadow-xl`}
          />
        </LongPressLink>
        <LongPressLink
          href={`/${type}/${item.id}`}
          spotifyUrl={item?.external_urls?.spotify}
          accessToken={accessToken}
        >
          <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
            {item.name}
          </h4>
        </LongPressLink>
        {type === "artist" ? (
          <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px]">
            {item.followers.total.toLocaleString()} Followers
          </h4>
        ) : type === "playlist" ? (
          <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px]">
            {item.tracks.total.toLocaleString()} Songs
          </h4>
        ) : (
          <h4 className="text-[28px] font-[560] text-white truncate tracking-tight max-w-[280px]">
            {item.artists?.map((artist) => artist.name).join(", ")}
          </h4>
        )}
      </div>
    );
  };

  return (
    <div className="relative min-h-screen">
      {!loading && (
        <div className="relative z-10 grid grid-cols-[2.21fr_3fr] fadeIn-animation">
          <div
            className="h-screen overflow-y-auto pb-12 pl-8 relative scroll-container scroll-smooth"
            style={{ willChange: "transform" }}
          >
            <Sidebar
              activeSection={activeSection}
              setActiveSection={setActiveSection}
            />
          </div>

          <div className="h-screen overflow-y-auto pt-2">
            <div className="-ml-2">
              <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="h-screen flex overflow-x-auto scroll-container pl-6 transition-all duration-500 ease-in-out"
                style={{
                  willChange: "transform",
                  scrollBehavior: "smooth",
                  scrollSnapType: "x mandatory",
                  scrollTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {activeSection === "recents" &&
                  albumsQueue.map((album, index) =>
                    renderItem(album, index, "album")
                  )}

                {activeSection === "library" && (
                  <>
                    {likedSongs &&
                      renderItem(
                        {
                          ...likedSongs,
                          id: "liked-songs",
                          images: [
                            {
                              url: "https://misc.scdn.co/liked-songs/liked-songs-640.png",
                            },
                          ],
                        },
                        0,
                        "playlist"
                      )}
                    {playlists.map((item, index) =>
                      renderItem(item, index + 1, "playlist")
                    )}
                  </>
                )}

                {activeSection === "artists" &&
                  artists.map((artist, index) =>
                    renderItem(artist, index, "artist")
                  )}

                {activeSection === "radio" &&
                  radio.map((playlist, index) =>
                    renderItem(playlist, index, "playlist")
                  )}

                {activeSection === "settings" && (
                  <div className="w-full h-full overflow-y-auto">
                    <Settings
                      accessToken={accessToken}
                      onOpenDonationModal={() => setShowDonationModal(true)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {showDonationModal && (
        <DonationQRModal onClose={() => setShowDonationModal(false)} />
      )}
    </div>
  );
}
