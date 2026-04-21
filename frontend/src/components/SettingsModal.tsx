"use client";

import { useState, useEffect } from "react";
import { X, Check, Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { fetchSettings, updateSettings } from "@/lib/api";
import type { SettingsConfig } from "@/lib/api";
import type { Locale } from "@/lib/i18n";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  locale: Locale;
}

const LLM_PROVIDERS = [
  { id: "deepseek", label: "DeepSeek" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "custom", label: "Custom" },
];

const DATA_PROVIDERS = [
  { id: "yahoo", label: "Yahoo Finance" },
  { id: "polygon", label: "Polygon.io" },
];

export default function SettingsModal({ isOpen, onClose, locale }: Props) {
  const [config, setConfig] = useState<SettingsConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setSaved(false);
      fetchSettings()
        .then((data) => setConfig(data))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await updateSettings({
        data_provider: config.data_provider,
        polygon_api_key: config.polygon_api_key,
        tradier_api_key: config.tradier_api_key,
        llm_provider: config.llm_provider,
        llm_api_key: config.llm_api_key,
        llm_base_url: config.llm_base_url,
        llm_model: config.llm_model,
      });
      setConfig({ ...updated, llm_presets: config.llm_presets });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleProviderChange = (provider: string) => {
    if (!config) return;
    const preset = config.llm_presets?.[provider];
    setConfig({
      ...config,
      llm_provider: provider,
      llm_base_url: preset?.base_url || config.llm_base_url,
      llm_model: preset?.model || config.llm_model,
    });
  };

  const inputClass =
    "w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-800 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all";
  const labelClass = "text-xs font-medium text-gray-500 mb-1 block";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">{t("settings.title", locale)}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition p-1 rounded-lg hover:bg-gray-100 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : config ? (
          <div className="px-6 py-5 space-y-6">
            {/* Data Provider */}
            <div>
              <label className={labelClass}>{t("settings.dataProvider", locale)}</label>
              <div className="flex gap-2">
                {DATA_PROVIDERS.map((dp) => (
                  <button
                    key={dp.id}
                    onClick={() => setConfig({ ...config, data_provider: dp.id })}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                      config.data_provider === dp.id
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {dp.label}
                  </button>
                ))}
              </div>
              {config.data_provider === "polygon" && (
                <div className="mt-3">
                  <label className={labelClass}>{t("settings.polygonKey", locale)}</label>
                  <input
                    type="password"
                    value={config.polygon_api_key}
                    onChange={(e) => setConfig({ ...config, polygon_api_key: e.target.value })}
                    placeholder="pk_..."
                    className={inputClass}
                  />
                </div>
              )}
            </div>

            {/* Tradier API Key */}
            <div>
              <label className={labelClass}>
                Tradier API Key
                <span className="ml-2 text-xs text-blue-500 font-normal">
                  <a href="https://developer.tradier.com/user/sign_up" target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {locale === "zh" ? "免费获取 →" : "Get free key →"}
                  </a>
                </span>
              </label>
              <input
                type="password"
                value={config.tradier_api_key || ""}
                onChange={(e) => setConfig({ ...config, tradier_api_key: e.target.value })}
                placeholder={locale === "zh" ? "输入 Tradier API Key（用于精准希腊字母）" : "Enter Tradier API Key (for accurate Greeks)"}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                {locale === "zh"
                  ? "✓ 提供专业级期权希腊字母（Delta/Gamma/Theta/Vega），免费注册即可使用"
                  : "✓ Provides professional-grade Greeks (Delta/Gamma/Theta/Vega). Free to sign up."}
              </p>
            </div>

            {/* LLM Provider */}
            <div>
              <label className={labelClass}>{t("settings.llmProvider", locale)}</label>
              <div className="flex gap-2 flex-wrap">
                {LLM_PROVIDERS.map((lp) => (
                  <button
                    key={lp.id}
                    onClick={() => handleProviderChange(lp.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                      config.llm_provider === lp.id
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {lp.label}
                  </button>
                ))}
              </div>
            </div>

            {/* LLM API Key */}
            <div>
              <label className={labelClass}>{t("settings.apiKey", locale)}</label>
              <input
                type="password"
                value={config.llm_api_key}
                onChange={(e) => setConfig({ ...config, llm_api_key: e.target.value })}
                placeholder="sk-..."
                className={inputClass}
              />
            </div>

            {/* LLM Base URL */}
            <div>
              <label className={labelClass}>{t("settings.baseUrl", locale)}</label>
              <input
                type="text"
                value={config.llm_base_url}
                onChange={(e) => setConfig({ ...config, llm_base_url: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                className={inputClass}
              />
            </div>

            {/* LLM Model */}
            <div>
              <label className={labelClass}>{t("settings.model", locale)}</label>
              <input
                type="text"
                value={config.llm_model}
                onChange={(e) => setConfig({ ...config, llm_model: e.target.value })}
                placeholder="deepseek-chat"
                className={inputClass}
              />
            </div>

            {/* Save Button */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white rounded-xl font-medium text-sm transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("settings.saving", locale)}
                </>
              ) : saved ? (
                <>
                  <Check className="w-4 h-4" />
                  {t("settings.saved", locale)}
                </>
              ) : (
                t("settings.save", locale)
              )}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
