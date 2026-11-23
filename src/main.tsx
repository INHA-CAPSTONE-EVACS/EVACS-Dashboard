import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardPage } from './pages/DashboardPage';
import 'pretendard/dist/web/variable/pretendardvariable.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DashboardPage />
  </StrictMode>,
);
