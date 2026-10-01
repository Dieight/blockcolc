import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { localWeatherConditionLabel, WorldWeatherAttribution, WorldWeatherSettingsStatus } from './WorldWeatherStatus';
import type { WorldWeatherView } from './use-world-weather';

const local: WorldWeatherView = {
  syncState: 'not_synced', override: null, conditionText: null, attributions: [], observedAt: null, locationSource: null,
  source: 'local', fallbackReason: null,
  visualPrecipitationIntensity: 0,
  astronomyContext: null, astronomySyncState: 'not_synced', astronomyFailureReason: null,
};

describe('world weather status and attribution', () => {
  it('distinguishes disabled, not-yet-synced, and current real weather in Settings', () => {
    const disabled = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled={false} view={local}/>);
    const disabledWithCacheClearFailure = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled={false} view={{ ...local,
      syncState: 'fallback', fallbackReason: 'cache_clear_failed' }}/>);
    const notSynced = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={local}/>);
    const current = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      syncState: 'available', source: 'real', conditionText: '小雨', observedAt: '2026-09-24T09:00:00+08:00', locationSource: 'fresh' }}/>);
    const cached = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      syncState: 'available', source: 'real', conditionText: '晴', locationSource: 'cached' }}/>);

    expect(disabled).toContain('已关闭');
    expect(disabledWithCacheClearFailure).toContain('本机位置缓存未能清除');
    expect(notSynced).toContain('尚未同步');
    expect(current).toContain('当前显示 小雨');
    expect(current).toContain('数据时间');
    expect(cached).toContain('使用本机上次保存的位置');
  });

  it('shows distinct safe reasons for request failures and invalid responses', () => {
    const requestFailed = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      syncState: 'fallback', fallbackReason: 'request_failed' }}/>);
    const invalidResponse = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      syncState: 'fallback', fallbackReason: 'invalid_response' }}/>);

    expect(requestFailed).toContain('天气网络请求失败');
    expect(invalidResponse).toContain('现实天气返回数据无效');
    expect(invalidResponse).toContain('处理后关闭并重新开启天气同步');
    expect(requestFailed).toContain('当前使用本地天气');
    expect(requestFailed).not.toBe(invalidResponse);
  });

  it('reports calendar synchronization separately from authorized local ephemeris fallback', () => {
    const calendar = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      astronomySyncState: 'calendar', astronomyContext: {
        coordinates: { latitude: 39.92, longitude: 116.41 }, locationSource: 'cached', schedule: {
          coordinates: { latitude: 39.92, longitude: 116.41 }, locationSource: 'cached',
          fetchedAtMs: 1_800_000_000_000, days: [], attribution: ['https://developer.qweather.com/attribution.html'],
        },
      } }}/>);
    const ephemeris = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      astronomySyncState: 'ephemeris_only', astronomyFailureReason: 'network_unavailable', astronomyContext: {
        coordinates: { latitude: 39.92, longitude: 116.41 }, schedule: null, locationSource: 'fresh',
      } }}/>);
    const unavailable = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      astronomySyncState: 'unavailable', astronomyFailureReason: 'location_unavailable' }}/>);

    expect(calendar).toContain('天文日历已同步');
    expect(calendar).toContain('数据来源：');
    expect(calendar).toContain('href="https://developer.qweather.com/attribution.html"');
    expect(ephemeris).toContain('按已授权位置本地历算');
    expect(ephemeris).not.toContain('天文日历已同步');
    expect(unavailable).toContain('聚落继续使用本地光照');
  });

  it('separates a missing native request path from a service restriction response', () => {
    const nativeMissing = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      syncState: 'fallback', fallbackReason: 'native_plugin_unavailable' }}/>);
    const securityRestricted = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      syncState: 'fallback', fallbackReason: 'security_restriction' }}/>);
    const requestInvalid = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      syncState: 'fallback', fallbackReason: 'request_invalid' }}/>);

    expect(nativeMissing).toContain('服务端未收到请求');
    expect(securityRestricted).toContain('核对 API 与 Android 应用限制');
    expect(requestInvalid).toContain('请求参数或位置');
    expect(nativeMissing).not.toBe(securityRestricted);
  });

  it('keeps the QWeather attribution in Settings and filters unsupported provider links', () => {
    const html = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      syncState: 'available', source: 'real', conditionText: '多云',
      attributions: ['https://developer.qweather.com/attribution.html', '合作数据仅供展示', 'javascript:alert(1)'] }}/>);

    expect(html).toContain('和风天气');
    expect(html).toContain('href="https://www.qweather.com"');
    expect(html).toContain('数据归因 ↗');
    expect(html).toContain('href="https://developer.qweather.com/attribution.html"');
    expect(html).toContain('合作数据仅供展示');
    expect(html).not.toContain('javascript:alert');
  });

  it('merges weather and astronomy sources without losing distinct status or unique attribution', () => {
    const attribution = 'https://developer.qweather.com/attribution.html';
    const html = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled view={{ ...local,
      syncState: 'available', source: 'real', conditionText: '小雨', attributions: [attribution, '合作数据仅供展示'],
      astronomySyncState: 'calendar', astronomyContext: {
        coordinates: { latitude: 39.92, longitude: 116.41 }, locationSource: 'fresh', schedule: {
          coordinates: { latitude: 39.92, longitude: 116.41 }, locationSource: 'fresh',
          fetchedAtMs: 1_800_000_000_000, days: [], attribution: [attribution,
            'https://example.com/astronomy-attribution', '合作数据仅供展示', 'javascript:alert(1)'],
        },
      } }}/>);
    expect(html.match(/class="weather-setting-attribution"/g)).toHaveLength(1);
    expect(html.match(/href="https:\/\/developer.qweather.com\/attribution.html"/g)).toHaveLength(1);
    expect(html.match(/合作数据仅供展示/g)).toHaveLength(1);
    expect(html).toContain('href="https://example.com/astronomy-attribution"');
    expect(html).toContain('当前显示 小雨');
    expect(html).toContain('天文日历已同步');
    expect(html).not.toContain('javascript:alert');
    const disabled = renderToStaticMarkup(<WorldWeatherSettingsStatus enabled={false} view={{ ...local,
      source: 'real', attributions: [attribution], astronomySyncState: 'calendar' }}/>);
    expect(disabled).not.toContain('class="weather-setting-attribution"');
  });

  it('shows the current local or real weather in the world notice', () => {
    const localLabel = renderToStaticMarkup(<WorldWeatherAttribution view={local}/>);
    const realLabel = renderToStaticMarkup(<WorldWeatherAttribution view={{ ...local,
      syncState: 'available', source: 'real', conditionText: '小雨' }}/>);
    const failedLabel = renderToStaticMarkup(<WorldWeatherAttribution view={{ ...local,
      syncState: 'fallback', fallbackReason: 'request_failed' }}/>);

    expect(localLabel).toContain('当前天气：本地天气（本地）');
    expect(failedLabel).toContain('当前天气：本地天气（本地）');
    expect(realLabel).toContain('当前天气：小雨（和风天气）');
    expect(realLabel).not.toContain('数据来源');
    expect(localWeatherConditionLabel('clear')).toBe('晴');
    expect(localWeatherConditionLabel('rain')).toBe('小雨');
  });
});
