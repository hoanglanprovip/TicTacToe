import { useState } from 'react';
import { useApp } from '../store';

interface Props {
  onSend: (text: string) => void;
}

const QUICK = ['Chao ban!', 'Ra don di!', 'Kho qua!', 'Dinh that!', 'Tai dau nhe!'];

export function Chat({ onSend }: Props) {
  const chat = useApp((s) => s.chat);
  const user = useApp((s) => s.user);
  const [text, setText] = useState('');

  const send = () => {
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText('');
  };

  return (
    <div className="chat">
      <div className="chat-title">
        <span>HOI THOAI TRAN DAU</span>
      </div>
      <div className="chat-log">
        {chat.length === 0 && <div className="chat-empty">Chưa có ai lên tiếng. Hãy gửi câu chào!</div>}
        {chat.map((message, i) => {
          const isMine = user && message.userId === user.id;
          return (
            <div key={`${message.at}-${i}`} className={`chat-bubble ${isMine ? 'mine' : ''}`}>
              <b>{isMine ? 'BẠN' : message.username}:</b> {message.text}
            </div>
          );
        })}
      </div>
      <div className="chat-quick">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => onSend(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={text}
          maxLength={300}
          placeholder="Nhập lời thoại thoại…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <button type="button" className="primary" onClick={send}>
          GỬI
        </button>
      </div>
    </div>
  );
}
