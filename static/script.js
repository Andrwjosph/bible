document.addEventListener('DOMContentLoaded', function() {
    const chatForm = document.getElementById('chat-form');
    const userInput = document.getElementById('user-input');
    const chatBox = document.getElementById('chat-box');
    const typingIndicator = document.getElementById('typing-indicator');
    const suggestionCards = document.querySelectorAll('.suggestion-card');
    const welcomeSection = document.querySelector('.welcome-section');
    const stopGenerationButton = document.getElementById('stop-generation');
    let currentController = null;

    // Handle new chat button
    document.querySelector('.new-chat').addEventListener('click', () => {
        // Save current chat if there are messages
        if (chatBox.children.length > 0) {
            // Get all messages from the current chat
            const messages = Array.from(chatBox.children);
            let lastUserMessage = '';
            
            // Find the last user message
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].classList.contains('user')) {
                    lastUserMessage = messages[i].textContent;
                    break;
                }
            }
            
            // Add to previous chats if we found a user message
            if (lastUserMessage) {
                addToPreviousChats(lastUserMessage);
            }
        }

        // Clear chat box
        chatBox.innerHTML = '';
        
        // Show welcome section
        if (welcomeSection) {
            welcomeSection.style.display = 'block';
        }

        // Clear input
        userInput.value = '';
        
        // Hide typing indicator and more details button
        typingIndicator.classList.add('hidden');
        const moreDetailsButton = document.querySelector('.more-details-button');
        if (moreDetailsButton) {
            moreDetailsButton.style.display = 'none';
        }

        // Scroll to top
        chatBox.scrollTop = 0;
    });

    // Handle suggestion card clicks
    suggestionCards.forEach(card => {
        card.addEventListener('click', function() {
            userInput.value = this.textContent.trim();
            userInput.focus();
        });
    });

    // Handle stop generation button
    stopGenerationButton.addEventListener('click', () => {
        if (currentController) {
            currentController.abort();
            currentController = null;
            hideTypingIndicator();
            stopGenerationButton.classList.add('hidden');
            appendMessage('ai', 'Generation stopped. You can ask a new question.');
        }
    });

    chatForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const message = userInput.value.trim();
        if (!message) return;

        // Hide welcome section after first message
        if (welcomeSection) {
            welcomeSection.style.display = 'none';
        }

        appendMessage('user', message);
        userInput.value = '';
        showTypingIndicator('thinking');
        stopGenerationButton.classList.remove('hidden');

        // Create new AbortController for this request
        currentController = new AbortController();

        fetch('/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: message }),
            signal: currentController.signal
        })
        .then(response => response.json())
        .then(data => {
            hideTypingIndicator();
            stopGenerationButton.classList.add('hidden');
            setTimeout(() => {
                appendMessageWithTypingEffect('ai', data.answer, message, false);
                // Add to previous chats after getting the answer
                addToPreviousChats(message, data.answer);
            }, 300);
        })
        .catch(error => {
            if (error.name === 'AbortError') {
                console.log('Request was aborted');
                return;
            }
            hideTypingIndicator();
            stopGenerationButton.classList.add('hidden');
            appendMessage('ai', 'An error occurred. Please try again.');
            console.error('Error:', error);
        });
    });

    function appendMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', sender);
        
        // Create content wrapper
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        messageDiv.appendChild(contentDiv);

        // Add text content
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.textContent = text;
        contentDiv.appendChild(textDiv);

        // Add edit button for user messages
        if (sender === 'user') {
            const editButton = document.createElement('button');
            editButton.className = 'edit-button';
            editButton.innerHTML = '<i class="fas fa-edit"></i>';
            editButton.addEventListener('click', () => {
                // Create input field
                const inputField = document.createElement('input');
                inputField.type = 'text';
                inputField.value = textDiv.textContent;
                inputField.className = 'edit-input';
                
                // Create save button
                const saveButton = document.createElement('button');
                saveButton.className = 'save-button';
                saveButton.innerHTML = '<i class="fas fa-check"></i>';
                
                // Create cancel button
                const cancelButton = document.createElement('button');
                cancelButton.className = 'cancel-button';
                cancelButton.innerHTML = '<i class="fas fa-times"></i>';
                
                // Replace text with input and buttons
                textDiv.textContent = '';
                textDiv.appendChild(inputField);
                textDiv.appendChild(saveButton);
                textDiv.appendChild(cancelButton);
                inputField.focus();
                
                // Handle save
                saveButton.addEventListener('click', () => {
                    const newText = inputField.value.trim();
                    if (newText && newText !== text) {
                        // Remove all messages after this one
                        let nextNode = messageDiv.nextSibling;
                        while (nextNode) {
                            const nodeToRemove = nextNode;
                            nextNode = nextNode.nextSibling;
                            chatBox.removeChild(nodeToRemove);
                        }
                        
                        // Update text
                        textDiv.textContent = newText;
                        
                        // Show typing indicator and regenerate response
                        showTypingIndicator('thinking');
                        stopGenerationButton.classList.remove('hidden');
                        
                        // Create new AbortController for this request
                        currentController = new AbortController();
                        
                        fetch('/ask', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ question: newText }),
                            signal: currentController.signal
                        })
                        .then(response => response.json())
                        .then(data => {
                            hideTypingIndicator();
                            stopGenerationButton.classList.add('hidden');
                            setTimeout(() => {
                                appendMessageWithTypingEffect('ai', data.answer, newText, false);
                                // Update previous chats
                                addToPreviousChats(newText, data.answer);
                            }, 300);
                        })
                        .catch(error => {
                            if (error.name === 'AbortError') {
                                console.log('Request was aborted');
                                return;
                            }
                            hideTypingIndicator();
                            stopGenerationButton.classList.add('hidden');
                            appendMessage('ai', 'An error occurred. Please try again.');
                            console.error('Error:', error);
                        });
                    } else {
                        // If no changes or empty, just restore the original text
                        textDiv.textContent = text;
                    }
                });
                
                // Handle cancel
                cancelButton.addEventListener('click', () => {
                    textDiv.textContent = text;
                });
                
                // Handle Enter key in input
                inputField.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        saveButton.click();
                    }
                });
                
                // Handle Escape key in input
                inputField.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        cancelButton.click();
                    }
                });
            });
            
            contentDiv.appendChild(editButton);
        }

        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function appendMessageWithTypingEffect(sender, text, originalQuestion, isDetailed = false) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', sender);
        
        // Add message content
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        messageDiv.appendChild(contentDiv);

        // Add message text with typing effect
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        contentDiv.appendChild(textDiv);

        // Add edit button for user messages
        if (sender === 'user') {
            const editButton = document.createElement('button');
            editButton.className = 'edit-button';
            editButton.innerHTML = '<i class="fas fa-edit"></i>';
            editButton.addEventListener('click', () => {
                // Create input field
                const inputField = document.createElement('input');
                inputField.type = 'text';
                inputField.value = text;
                inputField.className = 'edit-input';
                
                // Create save button
                const saveButton = document.createElement('button');
                saveButton.className = 'save-button';
                saveButton.innerHTML = '<i class="fas fa-check"></i>';
                
                // Create cancel button
                const cancelButton = document.createElement('button');
                cancelButton.className = 'cancel-button';
                cancelButton.innerHTML = '<i class="fas fa-times"></i>';
                
                // Replace text with input and buttons
                textDiv.textContent = '';
                textDiv.appendChild(inputField);
                textDiv.appendChild(saveButton);
                textDiv.appendChild(cancelButton);
                inputField.focus();
                
                // Handle save
                saveButton.addEventListener('click', () => {
                    const newText = inputField.value.trim();
                    if (newText && newText !== text) {
                        // Remove all messages after this one
                        let nextNode = messageDiv.nextSibling;
                        while (nextNode) {
                            const nodeToRemove = nextNode;
                            nextNode = nextNode.nextSibling;
                            chatBox.removeChild(nodeToRemove);
                        }
                        
                        // Update text
                        textDiv.textContent = newText;
                        
                        // Show typing indicator and regenerate response
                        showTypingIndicator('thinking');
                        stopGenerationButton.classList.remove('hidden');
                        
                        // Create new AbortController for this request
                        currentController = new AbortController();
                        
                        fetch('/ask', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ question: newText }),
                            signal: currentController.signal
                        })
                        .then(response => response.json())
                        .then(data => {
                            hideTypingIndicator();
                            stopGenerationButton.classList.add('hidden');
                            setTimeout(() => {
                                appendMessageWithTypingEffect('ai', data.answer, newText, false);
                                // Update previous chats
                                addToPreviousChats(newText, data.answer);
                            }, 300);
                        })
                        .catch(error => {
                            if (error.name === 'AbortError') {
                                console.log('Request was aborted');
                                return;
                            }
                            hideTypingIndicator();
                            stopGenerationButton.classList.add('hidden');
                            appendMessage('ai', 'An error occurred. Please try again.');
                            console.error('Error:', error);
                        });
                    } else {
                        // If no changes or empty, just restore the original text
                        textDiv.textContent = text;
                    }
                });
                
                // Handle cancel
                cancelButton.addEventListener('click', () => {
                    textDiv.textContent = text;
                });
                
                // Handle Enter key in input
                inputField.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        saveButton.click();
                    }
                });
                
                // Handle Escape key in input
                inputField.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        cancelButton.click();
                    }
                });
            });
            
            contentDiv.appendChild(editButton);
        }

        chatBox.appendChild(messageDiv);
        scrollToBottom();

        // Add feedback buttons for AI messages
        if (sender === 'ai') {
            const feedbackButtons = document.createElement('div');
            feedbackButtons.className = 'feedback-buttons';
            feedbackButtons.innerHTML = `
                <button class="feedback-button positive" onclick="handleFeedback(this.parentElement.parentElement, '${text}', true)">
                    <i class="fas fa-thumbs-up"></i>
                </button>
                <button class="feedback-button negative" onclick="handleFeedback(this.parentElement.parentElement, '${text}', false)">
                    <i class="fas fa-thumbs-down"></i>
                </button>
            `;
            contentDiv.appendChild(feedbackButtons);
        }

        // Add word-by-word typing effect
        if (sender === 'ai') {
            const words = text.split(' ');
            let currentWord = 0;

            function typeNextWord() {
                if (currentWord < words.length) {
                    textDiv.textContent += (currentWord === 0 ? '' : ' ') + words[currentWord];
                    currentWord++;
                    scrollToBottom();
                    setTimeout(typeNextWord, 50);
                } else {
                    // Add "Explain Further" button after typing is complete
                    if (!isDetailed) {
                        const moreDetailsButton = document.createElement('button');
                        moreDetailsButton.className = 'more-details-button';
                        moreDetailsButton.innerHTML = '<i class="fas fa-lightbulb"></i> Explain Further';
                        moreDetailsButton.addEventListener('click', () => getDetailedResponse(text));
                        contentDiv.appendChild(moreDetailsButton);
                    }
                }
            }

            typeNextWord();
        } else {
            textDiv.textContent = text;
        }
    }

    // Handle feedback
    function handleFeedback(messageDiv, text, isPositive) {
        const feedbackButtons = messageDiv.querySelector('.feedback-buttons');
        const buttons = feedbackButtons.querySelectorAll('.feedback-button');
        
        // Remove active class from all buttons
        buttons.forEach(button => button.classList.remove('active'));
        
        // Add active class to clicked button
        const clickedButton = isPositive ? buttons[0] : buttons[1];
        clickedButton.classList.add('active');
        
        // Disable both buttons after feedback
        buttons.forEach(button => button.disabled = true);
        
        // Send feedback to backend
        fetch('/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                isPositive: isPositive
            })
        })
        .catch(error => console.error('Error sending feedback:', error));
    }

    function showTypingIndicator(type) {
        typingIndicator.classList.remove('hidden');
        typingIndicator.innerHTML = type === 'thinking' 
            ? '<div class="typing-text">thinking<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div>'
            : '<div class="typing-text">Generating detailed explanation<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div>';
    }

    function hideTypingIndicator() {
        typingIndicator.classList.add('hidden');
    }

    // Auto-scroll functionality
    function scrollToBottom() {
        const chatBox = document.getElementById('chat-box');
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Handle previous chats
    function addToPreviousChats(question, answer) {
        const previousChatsList = document.getElementById('previous-chats-list');
        
        // Clear the list first to avoid duplicates
        if (!previousChatsList.hasChildNodes()) {
            previousChatsList.innerHTML = '';
        }

        // Create new chat item
        const chatItem = document.createElement('button');
        chatItem.className = 'sidebar-button';
        chatItem.innerHTML = `
            <i class="fas fa-history"></i>
            <span>${question.substring(0, 30)}${question.length > 30 ? '...' : ''}</span>
        `;
        
        // Add click handler
        chatItem.addEventListener('click', () => {
            // Hide welcome section
            if (welcomeSection) {
                welcomeSection.style.display = 'none';
            }
            
            // Clear current chat
            chatBox.innerHTML = '';
            
            // Add the selected conversation
            appendMessageWithTypingEffect('user', question, question);
            if (answer) {
                appendMessageWithTypingEffect('ai', answer, question);
            }
        });
        
        // Insert at the beginning of the list
        previousChatsList.insertBefore(chatItem, previousChatsList.firstChild);
        
        // Keep only the last 10 chats
        while (previousChatsList.children.length > 10) {
            previousChatsList.removeChild(previousChatsList.lastChild);
        }

        // Save to local storage
        saveChatHistory(question, answer);
    }

    // Add new function for saving chat history
    function saveChatHistory(question, answer) {
        const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
        history.unshift({ 
            question, 
            answer, 
            timestamp: new Date().toISOString() 
        });
        
        // Keep only last 10 chats
        if (history.length > 10) {
            history.length = 10;
        }
        
        localStorage.setItem('chatHistory', JSON.stringify(history));
    }

    // Add new function for loading chat history
    function loadChatHistory() {
        const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
        const previousChatsList = document.getElementById('previous-chats-list');
        
        // Clear existing items
        previousChatsList.innerHTML = '';
        
        // Add each chat to the sidebar
        history.forEach(chat => {
            const chatItem = document.createElement('button');
            chatItem.className = 'sidebar-button';
            chatItem.innerHTML = `
                <i class="fas fa-history"></i>
                <span>${chat.question.substring(0, 30)}${chat.question.length > 30 ? '...' : ''}</span>
            `;
            
            chatItem.addEventListener('click', () => {
                // Hide welcome section
                if (welcomeSection) {
                    welcomeSection.style.display = 'none';
                }
                
                // Clear current chat
                chatBox.innerHTML = '';
                
                // Load the conversation
                appendMessageWithTypingEffect('user', chat.question, chat.question);
                if (chat.answer) {
                    appendMessageWithTypingEffect('ai', chat.answer, chat.question);
                }
            });
            
            previousChatsList.appendChild(chatItem);
        });
    }

    // Initialize chat history when the page loads
    loadChatHistory();

    // Settings functionality
    const settingsButton = document.querySelector('.sidebar-button.settings');
    const closeSettingsButton = document.querySelector('.close-settings');
    const chatSection = document.querySelector('.chat-section');
    const settingsSection = document.querySelector('.settings-section');
    const saveSettingsButton = document.querySelector('.save-settings');

    settingsButton.addEventListener('click', function() {
        chatSection.classList.add('hidden');
        settingsSection.classList.remove('hidden');
    });

    closeSettingsButton.addEventListener('click', function() {
        settingsSection.classList.add('hidden');
        chatSection.classList.remove('hidden');
    });

    saveSettingsButton.addEventListener('click', function() {
        // Save settings logic here
        const theme = document.getElementById('theme-select').value;
        const fontSize = document.getElementById('font-size').value;
        const typingSpeed = document.getElementById('typing-speed').value;
        const saveHistory = document.getElementById('save-history').checked;

        // Save to localStorage
        localStorage.setItem('theme', theme);
        localStorage.setItem('fontSize', fontSize);
        localStorage.setItem('typingSpeed', typingSpeed);
        localStorage.setItem('saveHistory', saveHistory);

        // Apply settings
        applySettings(theme, fontSize, typingSpeed, saveHistory);

        // Show success message
        showNotification('Settings saved successfully!', 'success');

        // Close settings
        settingsSection.classList.add('hidden');
        chatSection.classList.remove('hidden');
    });

    // Load saved settings
    const savedTheme = localStorage.getItem('theme') || 'light';
    const savedFontSize = localStorage.getItem('fontSize') || 'medium';
    const savedTypingSpeed = localStorage.getItem('typingSpeed') || 'medium';
    const savedSaveHistory = localStorage.getItem('saveHistory') !== 'false';

    document.getElementById('theme-select').value = savedTheme;
    document.getElementById('font-size').value = savedFontSize;
    document.getElementById('typing-speed').value = savedTypingSpeed;
    document.getElementById('save-history').checked = savedSaveHistory;

    // Apply saved settings
    applySettings(savedTheme, savedFontSize, savedTypingSpeed, savedSaveHistory);

    function getDetailedResponse(text) {
        // Disable the button immediately
        const button = event.target.closest('.more-details-button');
        button.disabled = true;
        button.classList.add('clicked');
        
        showTypingIndicator('detailed');
        stopGenerationButton.classList.remove('hidden');
        
        // Create new AbortController for this request
        currentController = new AbortController();
        
        fetch('/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                question: text,
                detailed: true 
            }),
            signal: currentController.signal
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (!data.answer) {
                throw new Error('No answer received from server');
            }
            hideTypingIndicator();
            stopGenerationButton.classList.add('hidden');
            setTimeout(() => {
                appendMessageWithTypingEffect('ai', data.answer, text, true);
            }, 300);
        })
        .catch(error => {
            if (error.name === 'AbortError') {
                console.log('Request was aborted');
                return;
            }
            console.error('Error:', error);
            hideTypingIndicator();
            stopGenerationButton.classList.add('hidden');
            appendMessage('ai', 'An error occurred. Please try again.');
        });
    }
});

function applySettings(theme, fontSize, typingSpeed, saveHistory) {
    // Apply theme
    document.body.className = theme;

    // Apply font size
    const fontSizeMap = {
        'small': '14px',
        'medium': '16px',
        'large': '18px'
    };
    document.body.style.fontSize = fontSizeMap[fontSize];

    // Apply typing speed
    window.typingSpeed = typingSpeed === 'slow' ? 50 : typingSpeed === 'medium' ? 30 : 15;

    // Apply chat history setting
    window.saveChatHistory = saveHistory;
    if (!saveHistory) {
        localStorage.removeItem('chatHistory');
    }
}