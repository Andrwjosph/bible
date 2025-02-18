document.addEventListener('DOMContentLoaded', function() {
    const chatForm = document.getElementById('chat-form');
    const userInput = document.getElementById('user-input');
    const chatBox = document.getElementById('chat-box');
    const typingIndicator = document.getElementById('typing-indicator');
    const suggestionCards = document.querySelectorAll('.suggestion-card');

    // Handle suggestion card clicks
    suggestionCards.forEach(card => {
        card.addEventListener('click', function() {
            userInput.value = this.textContent.trim();
            userInput.focus();
        });
    });

    chatForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const message = userInput.value.trim();
        if (!message) return;

        // Hide welcome section after first message
        const welcomeSection = document.querySelector('.welcome-section');
        if (welcomeSection) {
            welcomeSection.style.display = 'none';
        }

        appendMessage('user', message);
        userInput.value = '';
        showTypingIndicator();

        fetch('/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: message })
        })
        .then(response => response.json())
        .then(data => {
            hideTypingIndicator();
            appendMessage('ai', data.answer);
        })
        .catch(error => {
            hideTypingIndicator();
            appendMessage('ai', 'An error occurred. Please try again.');
            console.error('Error:', error);
        });
    });

    function appendMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', sender);
        messageDiv.textContent = text;
        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function showTypingIndicator() {
        typingIndicator.classList.remove('hidden');
    }

    function hideTypingIndicator() {
        typingIndicator.classList.add('hidden');
    }
});