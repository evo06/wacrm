import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // Read the locale from the environment, defaulting to Brazilian Portuguese.
  let locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'pt-BR';

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Keep the CRM usable when an unsupported locale is configured.
    locale = 'pt-BR';
    messages = (await import('../../messages/pt-BR.json')).default;
  }

  return {
    locale,
    messages
  };
});
