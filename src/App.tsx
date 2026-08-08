import './App.css'

import Waifu from './components/Waifu';
import ChatBox from './components/ChatBox';
// import TawkMessengerReact from '@tawk.to/tawk-messenger-react';

function App() {
  // const propertyId = import.meta.env.VITE_TAWK_PROPERTY_ID as string | undefined;
  // const widgetId = import.meta.env.VITE_TAWK_WIDGET_ID as string | undefined;
  return (
    <div style={{ background: '#000', height: '100vh', overflow: 'hidden' }}>
      {/* Credit top-left */}
      <div
        style={{
          position: 'fixed',
          top: 8,
          left: 12,
          zIndex: 10,
          fontSize: 12,
          fontFamily: 'sans-serif',
          letterSpacing: '0.5px',
          color: '#8be9fd',
          opacity: 0.75,
          userSelect: 'none'
        }}
      >
        made by thanh1934-cr7
      </div>


      <Waifu />
      <ChatBox />
    </div>
  );
}

export default App;
