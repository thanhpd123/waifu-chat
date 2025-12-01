import './App.css'

import Waifu from './components/Waifu';
import ChatBox from './components/ChatBox';
import TawkMessengerReact from '@tawk.to/tawk-messenger-react';

function App() {
  const propertyId = import.meta.env.VITE_TAWK_PROPERTY_ID as string | undefined;
  const widgetId = import.meta.env.VITE_TAWK_WIDGET_ID as string | undefined;
  return (
    <div style={{ background: '#000', height: '100vh', overflow: 'hidden' }}>
      <Waifu />
      <div className="tawk-widget">
        {propertyId && widgetId ? (
          <TawkMessengerReact
            propertyId={propertyId}
            widgetId={widgetId}
            onBeforeLoad={() => { /* noop to satisfy library expectations */ }}
            onLoad={() => console.log("✅ Tawk.to đã sẵn sàng phục vụ Waifu!")}
            onStatusChange={() => { /* noop to satisfy library expectations */ }}
          />
        ) : (
          <div style={{ position: 'fixed', top: 8, left: 8, zIndex: 4, color: '#fff', opacity: 0.7, fontSize: 12 }}>
            Tawk disabled: set VITE_TAWK_PROPERTY_ID and VITE_TAWK_WIDGET_ID
          </div>
        )}
      </div>
      <ChatBox />
    </div>
  );
}

export default App;
