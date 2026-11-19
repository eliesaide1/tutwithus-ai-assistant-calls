import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AP_AdminApp } from './screen/admin/AP_AdminApp.js';
import { AP_VoicePage } from './screen/voice/AP_VoicePage.js';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AP_VoicePage />} />
        <Route path="/admin/*" element={<AP_AdminApp />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
