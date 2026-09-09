/**
 * AERO INTEL top-strip live stations.
 *
 * Embeds prefer the official YouTube live player (`/api/youtube/live` resolves
 * the current video id for a channel handle). When YouTube blocks the embed
 * (error 101/150, bot-check, or no live id), the strip falls back to a documented
 * HLS URL when one exists, then to an "Open on YouTube" link.
 *
 * Official / documented sources (do not invent unpublished stream keys):
 * - Fox News YouTube: https://www.youtube.com/@FoxNews/live
 *   HLS preview (existing LiveNews catalog): https://247preview.foxnews.com/hls/live/2020027/fncv3preview/primary.m3u8
 * - CNN YouTube: https://www.youtube.com/@CNN/live
 * - MSNBC YouTube: https://www.youtube.com/@MSNBC/live
 * - ABC News YouTube: https://www.youtube.com/@ABCNews/live
 * - NBC News YouTube: https://www.youtube.com/@NBCNews/live
 * - CBS News YouTube: https://www.youtube.com/@CBSNews/live
 * - Newsmax YouTube: https://www.youtube.com/@NEWSMAX/live
 * - BBC News / BBC World YouTube: https://www.youtube.com/@BBCNews/live
 *   HLS (existing catalog, often UK-geo): vs-hls-push-uk.live.fastly.md.bbci.co.uk
 */
export interface LiveVideoStation {
  id: string;
  name: string;
  handle: string;
  /** Optional known YouTube video id used only when live detection fails. */
  fallbackVideoId?: string;
  /** Optional direct HLS, reused from LiveNewsPanel's documented map. */
  hlsUrl?: string;
  optional?: boolean;
}

export const DEFAULT_LIVE_VIDEO_STATION_ID = 'fox-news';

export const LIVE_VIDEO_STATIONS: readonly LiveVideoStation[] = [
  {
    id: 'fox-news',
    name: 'Fox News',
    handle: '@FoxNews',
    fallbackVideoId: 'QaftgYkG-ek',
    hlsUrl: 'https://247preview.foxnews.com/hls/live/2020027/fncv3preview/primary.m3u8',
  },
  {
    id: 'cnn',
    name: 'CNN',
    handle: '@CNN',
    fallbackVideoId: 'w_Ma8oQLmSM',
    hlsUrl: 'https://turnerlive.warnermediacdn.com/hls/live/586495/cnngo/cnn_slate/VIDEO_0_3564000.m3u8',
  },
  {
    id: 'msnbc',
    name: 'MSNBC',
    handle: '@MSNBC',
  },
  {
    id: 'abc-news',
    name: 'ABC',
    handle: '@ABCNews',
    hlsUrl: 'https://lnc-abc-news.tubi.video/index.m3u8',
  },
  {
    id: 'nbc-news',
    name: 'NBC',
    handle: '@NBCNews',
    fallbackVideoId: 'yMr0neQhu6c',
    hlsUrl: 'https://dai2.xumo.com/amagi_hls_data_xumo1212A-xumo-nbcnewsnow/CDN/master.m3u8',
  },
  {
    id: 'cbs-news',
    name: 'CBS',
    handle: '@CBSNews',
    fallbackVideoId: 'R9L8sDK8iEc',
    hlsUrl: 'https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f134e82a470f83d562deeca/master.m3u8',
  },
  {
    id: 'newsmax',
    name: 'Newsmax',
    handle: '@NEWSMAX',
    fallbackVideoId: 'S-lFBzloL2Y',
  },
  {
    id: 'bbc-news',
    name: 'BBC World',
    handle: '@BBCNews',
    fallbackVideoId: 'bjgQzJzCZKs',
    hlsUrl: 'https://vs-hls-push-uk.live.fastly.md.bbci.co.uk/x=4/i=urn:bbc:pips:service:bbc_news_channel_hd/iptv_hd_abr_v1.m3u8',
    optional: true,
  },
];

export function getLiveVideoStation(id: string): LiveVideoStation | undefined {
  return LIVE_VIDEO_STATIONS.find((station) => station.id === id);
}

export function youtubeLivePageUrl(handle: string): string {
  const clean = handle.startsWith('@') ? handle : `@${handle}`;
  return `https://www.youtube.com/${clean}/live`;
}

export function youtubeEmbedUrl(videoId: string, muted = true): string {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: muted ? '1' : '0',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
  });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}
