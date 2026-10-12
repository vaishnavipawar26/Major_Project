import { knownMessage, useLanguage } from "../i18n/LanguageContext";

/**
 * Text written by the backend in English (reasons, observations, warnings). Fixed sentences the
 * dictionary knows word for word are shown translated; anything else stays in English and, when
 * another language is selected, carries a visible "English" tag instead of pretending to be translated.
 */
export default function ServerText({ children, as: Tag = "span", className }) {
  const { lang, t } = useLanguage();
  const known = lang !== "en" ? knownMessage(t, children) : { text: children, translated: false };
  if (known.translated) return <Tag className={className}>{known.text}</Tag>;
  return (
    <Tag className={className} lang="en">
      {children}
      {lang !== "en" && <span className="server-tag">{t("server.englishTag")}</span>}
    </Tag>
  );
}
