import { useEffect, useRef, useState } from 'react';
import type { QWeatherFailureReason } from '@tomato-clock/platform-capacitor';
import type { WeatherKind } from '@tomato-clock/voxel';
import { isWorldWeatherFailureRetryable, type WorldWeatherView } from './use-world-weather';
import './styles/world-weather.css';

export const WORLD_WEATHER_NOTICE_DURATION_MS = 5_000;
export const WORLD_WEATHER_NOTICE_EXIT_MS = 180;

export function localWeatherConditionLabel(kind: WeatherKind): string {
  switch (kind) {
    case 'clear': return '晴';
    case 'cloudy': return '多云';
    case 'rain': return '小雨';
    case 'mist': return '雾';
    case 'snow': return '小雪';
  }
}

function safeAttribution(value: string): { text: string; href?: string } | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? { text, href: url.href } : null;
  } catch {
    // Provider attribution can be a statement rather than a URL. Display it
    // as escaped text, but never turn an unsupported scheme into a link.
    return /^[a-z][a-z0-9+.-]*:/i.test(text) ? null : { text };
  }
}

function failureLabel(reason: QWeatherFailureReason | 'unknown_condition' | null): string {
  switch (reason) {
    case 'location_permission_denied': return '位置权限未授予，不会使用缓存位置联网';
    case 'location_unavailable': return '定位不可用，已尝试本机缓存位置';
    case 'location_timeout': return '定位超时，已尝试本机缓存位置';
    case 'permission_unavailable': return '位置权限不可用';
    case 'request_cancelled': return '天气同步已取消';
    case 'cache_clear_failed': return '本机天气位置缓存未能清除';
    case 'not_configured': return '现实天气未配置，不会发起服务请求';
    case 'unsupported_platform': return '当前设备不可用';
    case 'native_plugin_unavailable': return '此 Android 构筑未接入天气组件，服务端未收到请求';
    case 'native_bridge_failed': return 'Android 天气调用失败，未确认服务端收到请求';
    case 'native_result_invalid': return 'Android 天气插件返回格式异常，未确认服务端收到请求';
    case 'signing_identity_unavailable': return '无法读取 Android 应用签名身份，未发出服务请求';
    case 'network_unavailable': return '网络不可用';
    case 'request_timeout': return '天气请求超时';
    case 'request_failed': return '天气网络请求失败';
    case 'authentication_failed': return '和风天气凭据验证失败';
    case 'security_restriction': return '和风天气安全限制拒绝请求，请核对 API 与 Android 应用限制';
    case 'invalid_host': return '和风天气 API Host 无效';
    case 'quota_exhausted': return '和风天气可用额度不足';
    case 'billing_issue': return '和风天气账单状态需要处理';
    case 'account_suspended': return '和风天气账户不可用';
    case 'api_deprecated': return '和风天气接口已停用';
    case 'access_denied': return '和风天气拒绝请求，请核对 API 限制与服务权限';
    case 'request_invalid': return '和风天气拒绝了请求参数或位置';
    case 'api_path_not_found': return '和风天气接口路径未找到，请核对当前授权 API';
    case 'rate_limited': return '和风天气暂时限制请求，请检查额度或稍后重试';
    case 'provider_unavailable': return '和风天气服务暂不可用';
    case 'response_too_large': return '天气响应超过安全大小限制';
    case 'unsupported_response_encoding': return '天气响应压缩格式无法识别';
    case 'invalid_response': return '现实天气返回数据无效，响应结构无法识别';
    case 'unknown_condition': return '天气现象暂未适配';
    case 'unknown': return '同步暂不可用';
    case null: return '天气状态暂不可用';
  }
}

function formatObservedAt(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(timestamp);
}

/** Weather status and provider attribution stay with the user's setting. */
export function WorldWeatherSettingsStatus({ enabled, view }: { enabled: boolean; view: WorldWeatherView }) {
  const attributions = view.attributions.map(safeAttribution)
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const observedAt = formatObservedAt(view.observedAt);
  const manualRetry = view.fallbackReason !== null && !isWorldWeatherFailureRetryable(view.fallbackReason);
  const status = !enabled
    ? view.fallbackReason === 'cache_clear_failed'
      ? '已关闭 · 本机位置缓存未能清除'
      : '已关闭 · 聚落继续使用本地天气'
    : view.source === 'real'
      ? `当前显示 ${view.conditionText ?? '现实天气'}${view.locationSource === 'cached' ? ' · 使用本机上次保存的位置' : ''}${observedAt ? ` · 数据时间 ${observedAt}` : ''}${view.syncState === 'syncing' ? ' · 正在刷新' : ''}`
      : view.syncState === 'not_synced'
        ? '尚未同步 · 返回计时页后开始获取'
        : view.syncState === 'syncing'
          ? '正在同步现实天气 · 当前暂用本地天气'
          : `${failureLabel(view.fallbackReason)} · 当前使用本地天气${manualRetry ? ' · 已暂停自动重试；处理后关闭并重新开启天气同步' : ''}`;

  return <div className="weather-setting-status" role="status" aria-live="polite">
    <small>{status}</small>
    {enabled && view.source === 'real' && <div className="weather-setting-attribution">
      <span>来源：</span>
      <a href="https://www.qweather.com" target="_blank" rel="noopener noreferrer">和风天气</a>
      {attributions.map((item, index) => item.href
        ? <a key={`${item.text}-${index}`} href={item.href} target="_blank" rel="noopener noreferrer" aria-label={`查看天气数据归因 ${index + 1}`}>数据归因 ↗</a>
        : <span key={`${item.text}-${index}`}>{item.text}</span>)}
    </div>}
  </div>;
}

/** The world shows one cold-start weather notice; availability stays in Settings. */
export function WorldWeatherAttribution({ view, localConditionText = '本地天气' }: { view: WorldWeatherView; localConditionText?: string }) {
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState(false);
  const noticeSequence = useRef(0);

  useEffect(() => {
    const sequence = ++noticeSequence.current;
    let exitAnimationTimer: number | null = null;
    const exitTimer = window.setTimeout(() => {
      setLeaving(true);
      exitAnimationTimer = window.setTimeout(() => {
        if (noticeSequence.current === sequence) setHidden(true);
      }, WORLD_WEATHER_NOTICE_EXIT_MS);
    }, WORLD_WEATHER_NOTICE_DURATION_MS);
    return () => {
      window.clearTimeout(exitTimer);
      if (exitAnimationTimer !== null) window.clearTimeout(exitAnimationTimer);
    };
  }, []);

  if (hidden) return null;
  const hasRealCondition = view.source === 'real' && Boolean(view.conditionText?.trim());
  const condition = hasRealCondition ? view.conditionText!.trim() : localConditionText;
  return <aside className={`world-weather-attribution-world${leaving ? ' is-leaving' : ''}`} aria-label="当前天气" role="status">
    <span>当前天气：{condition}（{hasRealCondition ? '和风天气' : '本地'}）</span>
  </aside>;
}
