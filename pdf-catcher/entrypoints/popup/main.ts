import { createApp } from 'vue';
import App from './App.vue';
import { i18n, setLanguage } from '@/modules/i18n';
import '@/modules/ui/panel.css';
import './styles.css';

setLanguage(i18n.global.locale.value as 'zh-CN' | 'en');

createApp(App).use(i18n).mount('#app');
