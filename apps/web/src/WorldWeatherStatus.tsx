import { t, appLocale, useI18n } from './i18n';
import { useEffect, useRef, useState } from 'react';
import type { QWeatherFailureReason } from '@blockcolc/platform-capacitor';
import type { WeatherKind } from '@blockcolc/voxel';
import { isWorldWeatherFailureRetryable, type WorldWeatherView } from './use-world-weather';
import './styles/world-weather.css';
import { realWeatherLabel } from './weather-labels';

export const WORLD_WEATHER_NOTICE_DURATION_MS = 5_000;
export const WORLD_WEATHER_NOTICE_EXIT_MS = 180;

export function localWeatherConditionLabel(kind: WeatherKind): string {
  switch (kind) {
    case 'clear': return t("晴");
    case 'cloudy': return t("多云");
    case 'rain': return t("小雨");
    case 'mist': return t("雾");
    case 'snow': return t("小雪");
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
    case 'location_permission_denied': return t("位置权限未授予，不会使用缓存位置联网");
    case 'location_unavailable': return t("定位不可用，已尝试本机缓存位置");
    case 'location_timeout': return t("定位超时，已尝试本机缓存位置");
    case 'permission_unavailable': return t("位置权限不可用");
    case 'request_cancelled': return t("天气同步已取消");
    case 'cache_clear_failed': return t("本机天气位置缓存未能清除");
    case 'not_configured': return t("现实天气未配置，不会发起服务请求");
    case 'unsupported_platform': return t("当前设备不可用");
    case 'native_plugin_unavailable': return t("此 Android 构筑未接入天气组件，服务端未收到请求");
    case 'native_bridge_failed': return t("Android 天气调用失败，未确认服务端收到请求");
    case 'native_result_invalid': return t("Android 天气插件返回格式异常，未确认服务端收到请求");
    case 'signing_identity_unavailable': return t("无法读取 Android 应用签名身份，未发出服务请求");
    case 'network_unavailable': return t("网络不可用");
    case 'request_timeout': return t("天气请求超时");
    case 'request_failed': return t("天气网络请求失败");
    case 'authentication_failed': return t("和风天气凭据验证失败");
    case 'security_restriction': return t("和风天气安全限制拒绝请求，请核对 API 与 Android 应用限制");
    case 'invalid_host': return t("和风天气 API Host 无效");
    case 'quota_exhausted': return t("和风天气可用额度不足");
    case 'billing_issue': return t("和风天气账单状态需要处理");
    case 'account_suspended': return t("和风天气账户不可用");
    case 'api_deprecated': return t("和风天气接口已停用");
    case 'access_denied': return t("和风天气拒绝请求，请核对 API 限制与服务权限");
    case 'request_invalid': return t("和风天气拒绝了请求参数或位置");
    case 'api_path_not_found': return t("和风天气接口路径未找到，请核对当前授权 API");
    case 'rate_limited': return t("和风天气暂时限制请求，请检查额度或稍后重试");
    case 'provider_unavailable': return t("和风天气服务暂不可用");
    case 'response_too_large': return t("天气响应超过安全大小限制");
    case 'unsupported_response_encoding': return t("天气响应压缩格式无法识别");
    case 'invalid_response': return t("现实天气返回数据无效，响应结构无法识别");
    case 'unknown_condition': return t("天气现象暂未适配");
    case 'unknown': return t("同步暂不可用");
    case null: return t("天气状态暂不可用");
  }
}

function formatObservedAt(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(appLocale(), {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(timestamp);
}

/** Weather status and provider attribution stay with the user's setting. */
export function WorldWeatherSettingsStatus({ enabled, view }: { enabled: boolean; view: WorldWeatherView }) {
  useI18n();
  const attributions = view.attributions.map(safeAttribution)
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const astronomyAttributions = (view.astronomyContext?.schedule?.attribution ?? []).map(safeAttribution)
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const hasWeatherSource = enabled && view.source === 'real';
  const hasAstronomySource = enabled && view.astronomySyncState === 'calendar';
  const sourceAttributions = [...(hasWeatherSource ? attributions : []),
    ...(hasAstronomySource ? astronomyAttributions : [])]
    .filter((item, index, items) => items.findIndex(other =>
      (other.href ?? other.text) === (item.href ?? item.text)) === index);
  const observedAt = formatObservedAt(view.observedAt);
  const manualRetry = view.fallbackReason !== null && !isWorldWeatherFailureRetryable(view.fallbackReason);
  const status = !enabled
    ? view.fallbackReason === 'cache_clear_failed'
      ? t("已关闭 · 本机位置缓存未能清除")
      : t("已关闭 · 聚落继续使用本地天气")
    : view.source === 'real'
      ? t("当前显示 {0}{1}{2}{3}", realWeatherLabel(view.conditionCode,view.conditionText), view.locationSource === 'cached' ? t(' · 使用本机上次保存的位置') : '', observedAt ? t(' · 数据时间 {0}',observedAt) : '', view.syncState === 'syncing' ? t(' · 正在刷新') : '')
      : view.syncState === 'not_synced'
        ? t("尚未同步 · 返回计时页后开始获取")
        : view.syncState === 'syncing'
          ? t("正在同步现实天气 · 当前暂用本地天气")
      : t("{0} · 当前使用本地天气{1}", failureLabel(view.fallbackReason), manualRetry ? t(' · 已暂停自动重试；处理后关闭并重新开启天气同步') : '');
  const astronomyStatus = !enabled
    ? t("天文增强已关闭")
    : view.astronomySyncState === 'calendar'
      ? t("天文日历已同步 · 日月方向按本地时间连续计算")
      : view.astronomySyncState === 'ephemeris_only'
        ? t("日历暂不可用 · 按已授权位置本地历算")
        : view.astronomySyncState === 'syncing'
          ? t("正在获取天文日历")
          : view.astronomySyncState === 'unavailable'
            ? t("天文位置不可用 · 聚落继续使用本地光照")
            : t("天文日历尚未同步");

  return <div className="weather-setting-status" role="status" aria-live="polite">
    <small>{status}</small>
    <small className="weather-astronomy-status">{astronomyStatus}</small>
    {(hasWeatherSource || hasAstronomySource) && <div className="weather-setting-attribution">
      <span>{t("数据来源：")}</span>
      <a href="https://www.qweather.com" target="_blank" rel="noopener noreferrer">{t("和风天气")}</a>
      {sourceAttributions.map((item, index) => item.href
        ? <a key={`${item.text}-${index}`} href={item.href} target="_blank" rel="noopener noreferrer" aria-label={t("查看天气与天文数据归因 {0}", index + 1)}>{t("数据归因 ↗")}</a>
        : <span key={`${item.text}-${index}`}>{item.text}</span>)}
    </div>}
  </div>;
}

/** The world shows one cold-start weather notice; availability stays in Settings. */
export function WorldWeatherAttribution({ view, localConditionText = t("本地天气") }: { view: WorldWeatherView; localConditionText?: string }) {
  useI18n();
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
  const condition = hasRealCondition ? realWeatherLabel(view.conditionCode,view.conditionText) : localConditionText;
  return <aside className={`world-weather-attribution-world${leaving ? ' is-leaving' : ''}`} aria-label={t("当前天气")} role="status">
    <span>{t("当前天气：")}{condition}（{hasRealCondition ? t("和风天气") : t("本地")}）</span>
  </aside>;
}
