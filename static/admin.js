document.addEventListener('DOMContentLoaded', function() {
    // Navigation
    const sidebarButtons = document.querySelectorAll('.sidebar-button');
    const sections = document.querySelectorAll('.admin-section');

    sidebarButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetSection = button.dataset.section;
            
            // Update active states
            sidebarButtons.forEach(btn => btn.classList.remove('active'));
            sections.forEach(section => section.classList.remove('active'));
            
            button.classList.add('active');
            document.getElementById(targetSection).classList.add('active');
        });
    });

    // Initialize charts
    let feedbackTrendChart = null;
    let themeDistributionChart = null;
    let themeSuccessChart = null;
    let timeAnalyticsChart = null;

    // Load initial data
    loadDashboardData();

    // Refresh button
    document.getElementById('refresh-data').addEventListener('click', loadDashboardData);

    // Threshold controls
    const successThreshold = document.getElementById('success-threshold');
    const successThresholdValue = document.getElementById('success-threshold-value');
    const minFeedback = document.getElementById('min-feedback');
    const saveThresholds = document.querySelector('.save-thresholds');

    successThreshold.addEventListener('input', (e) => {
        successThresholdValue.textContent = `${e.target.value}%`;
    });

    saveThresholds.addEventListener('click', () => {
        const thresholds = {
            success_rate: parseInt(successThreshold.value),
            min_feedback: parseInt(minFeedback.value)
        };

        fetch('/admin/thresholds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(thresholds)
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                showNotification('Thresholds updated successfully', 'success');
            }
        })
        .catch(error => {
            showNotification('Error updating thresholds', 'error');
        });
    });

    // Time analytics controls
    const timePeriodButtons = document.querySelectorAll('.time-period-button');
    timePeriodButtons.forEach(button => {
        button.addEventListener('click', () => {
            timePeriodButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            updateTimeAnalyticsChart(button.dataset.period);
        });
    });

    // Knowledge Base Management
    let knowledgeBase = {
        entries: [],
        categories: [],
        tags: []
    };

    // Load knowledge base data when the section is shown
    document.addEventListener('DOMContentLoaded', function() {
        // Add event listener for section changes
        document.querySelectorAll('.sidebar-button').forEach(button => {
            button.addEventListener('click', function() {
                const section = this.getAttribute('data-section');
                if (section === 'knowledge-base') {
                    loadKnowledgeBase();
                }
            });
        });
    });

    function loadDashboardData() {
        // Load overview data
        fetch('/admin/overview')
            .then(response => response.json())
            .then(data => {
                updateOverviewMetrics(data);
                updateFeedbackTrendChart(data.feedback_trend);
            })
            .catch(error => {
                showNotification('Error loading overview data', 'error');
            });

        // Load theme analysis
        fetch('/admin/themes')
            .then(response => response.json())
            .then(data => {
                updateThemeCharts(data);
                updateThemeTable(data.themes);
            })
            .catch(error => {
                showNotification('Error loading theme analysis', 'error');
            });

        // Load thresholds
        fetch('/admin/thresholds')
            .then(response => response.json())
            .then(data => {
                successThreshold.value = data.success_rate;
                successThresholdValue.textContent = `${data.success_rate}%`;
                minFeedback.value = data.min_feedback;
            })
            .catch(error => {
                showNotification('Error loading thresholds', 'error');
            });

        // Load recent feedback
        fetch('/admin/recent-feedback')
            .then(response => response.json())
            .then(data => {
                updateRecentFeedback(data);
            })
            .catch(error => {
                showNotification('Error loading recent feedback', 'error');
            });

        // Load time analytics
        updateTimeAnalyticsChart('hourly');
    }

    function updateOverviewMetrics(data) {
        document.getElementById('overall-success-rate').textContent = `${Math.round(data.success_rate)}%`;
        document.getElementById('total-feedback').textContent = data.total_feedback;
        document.getElementById('positive-feedback').textContent = `${Math.round(data.positive_rate)}%`;
        document.getElementById('active-themes').textContent = data.active_themes;
    }

    function updateFeedbackTrendChart(data) {
        if (feedbackTrendChart) {
            feedbackTrendChart.destroy();
        }

        const ctx = document.getElementById('feedback-trend').getContext('2d');
        feedbackTrendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'Success Rate',
                    data: data.success_rates,
                    borderColor: '#7c3aed',
                    tension: 0.4,
                    fill: true,
                    backgroundColor: 'rgba(124, 58, 237, 0.1)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100
                    }
                },
                plugins: {
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                }
            }
        });
    }

    function updateThemeCharts(data) {
        // Theme Distribution Chart
        if (themeDistributionChart) {
            themeDistributionChart.destroy();
        }

        const distributionCtx = document.getElementById('theme-distribution').getContext('2d');
        themeDistributionChart = new Chart(distributionCtx, {
            type: 'doughnut',
            data: {
                labels: data.themes.map(t => t.name),
                datasets: [{
                    data: data.themes.map(t => t.total),
                    backgroundColor: generateColors(data.themes.length)
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right'
                    }
                }
            }
        });

        // Theme Success Chart
        if (themeSuccessChart) {
            themeSuccessChart.destroy();
        }

        const successCtx = document.getElementById('theme-success').getContext('2d');
        themeSuccessChart = new Chart(successCtx, {
            type: 'bar',
            data: {
                labels: data.themes.map(t => t.name),
                datasets: [{
                    label: 'Success Rate',
                    data: data.themes.map(t => t.success_rate),
                    backgroundColor: '#7c3aed'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `Success Rate: ${context.raw.toFixed(1)}%`;
                            }
                        }
                    }
                }
            }
        });
    }

    function updateThemeTable(themes) {
        const tbody = document.getElementById('theme-table-body');
        tbody.innerHTML = '';

        themes.forEach(theme => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${theme.name}</td>
                <td>${Math.round(theme.success_rate)}%</td>
                <td>${theme.total}</td>
                <td>${theme.positive}</td>
                <td>${theme.negative}</td>
            `;
            tbody.appendChild(row);
        });
    }

    function updateRecentFeedback(feedback) {
        const container = document.getElementById('recent-feedback');
        container.innerHTML = '';

        feedback.forEach(item => {
            const feedbackElement = document.createElement('div');
            feedbackElement.className = 'feedback-item';
            feedbackElement.innerHTML = `
                <div class="feedback-item-header">
                    <span class="timestamp">${formatDate(item.timestamp)}</span>
                    <span class="sentiment ${item.isPositive ? 'positive' : 'negative'}">
                        ${item.isPositive ? 'Positive' : 'Negative'}
                    </span>
                </div>
                <div class="feedback-item-content">${item.text}</div>
            `;
            container.appendChild(feedbackElement);
        });
    }

    function updateTimeAnalyticsChart(period) {
        fetch('/admin/analytics/time')
            .then(response => response.json())
            .then(data => {
                if (timeAnalyticsChart) {
                    timeAnalyticsChart.destroy();
                }

                const ctx = document.getElementById('time-analytics-chart').getContext('2d');
                const periodData = data[period];

                timeAnalyticsChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: periodData.labels,
                        datasets: [{
                            label: 'Success Rate',
                            data: periodData.success_rates,
                            borderColor: '#7c3aed',
                            tension: 0.4,
                            fill: true,
                            backgroundColor: 'rgba(124, 58, 237, 0.1)'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: true,
                                max: 100
                            }
                        },
                        plugins: {
                            tooltip: {
                                mode: 'index',
                                intersect: false
                            }
                        }
                    }
                });
            })
            .catch(error => {
                showNotification('Error loading time analytics', 'error');
            });
    }

    function generateColors(count) {
        const colors = [];
        for (let i = 0; i < count; i++) {
            colors.push(`hsl(${(i * 360) / count}, 70%, 50%)`);
        }
        return colors;
    }

    function formatDate(timestamp) {
        return new Date(timestamp).toLocaleString();
    }

    function showNotification(message, type = 'success') {
        const container = document.getElementById('notification-container');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icon = type === 'success' ? 'check-circle' : 
                    type === 'error' ? 'exclamation-circle' : 'exclamation-triangle';
        
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-title">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close">
                <i class="fas fa-times"></i>
            </button>
        `;

        container.appendChild(notification);

        // Add close button functionality
        const closeButton = notification.querySelector('.notification-close');
        closeButton.addEventListener('click', () => {
            notification.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => {
                container.removeChild(notification);
            }, 300);
        });

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode === container) {
                notification.style.animation = 'slideOut 0.3s ease forwards';
                setTimeout(() => {
                    container.removeChild(notification);
                }, 300);
            }
        }, 5000);
    }

    function loadKnowledgeBase() {
        fetch('/admin/knowledge-base')
            .then(response => response.json())
            .then(data => {
                knowledgeBase = data;
                updateKnowledgeBaseUI();
            })
            .catch(error => showNotification('Error loading knowledge base', 'error'));
    }

    function updateKnowledgeBaseUI() {
        // Update filters
        const categoryFilter = document.getElementById('category-filter');
        const tagFilter = document.getElementById('tag-filter');
        
        categoryFilter.innerHTML = '<option value="">All Categories</option>' +
            knowledgeBase.categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
        
        tagFilter.innerHTML = '<option value="">All Tags</option>' +
            knowledgeBase.tags.map(tag => `<option value="${tag}">${tag}</option>`).join('');
        
        // Update entries list
        const entriesList = document.getElementById('entries-list');
        entriesList.innerHTML = knowledgeBase.entries.map(entry => `
            <div class="entry-card">
                <div class="header">
                    <h4>${entry.question}</h4>
                    <div>
                        <button onclick="editEntry('${entry.id}')" class="btn btn-sm btn-primary">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="deleteEntry('${entry.id}')" class="btn btn-sm btn-danger">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <p>${entry.answer}</p>
                <div class="tags">
                    ${entry.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                </div>
                <small class="text-muted">Category: ${entry.category}</small>
            </div>
        `).join('');
    }

    function importFromUrl() {
        const url = document.getElementById('url-input').value;
        const category = document.getElementById('url-category').value;
        const tags = document.getElementById('url-tags').value.split(',').map(t => t.trim());
        
        fetch('/admin/knowledge-base/import-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url, category, tags })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification(`Successfully imported ${data.chunks_imported} entries`);
                loadKnowledgeBase();
            }
        })
        .catch(error => showNotification('Error importing from URL', 'error'));
    }

    function importFromFile() {
        const fileInput = document.getElementById('file-input');
        const category = document.getElementById('file-category').value;
        const tags = document.getElementById('file-tags').value.split(',').map(t => t.trim());
        
        if (!fileInput.files[0]) {
            showNotification('Please select a file', 'error');
            return;
        }
        
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('category', category);
        formData.append('tags', tags.join(','));
        
        fetch('/admin/knowledge-base/import-file', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification(`Successfully imported ${data.chunks_imported} entries`);
                loadKnowledgeBase();
            }
        })
        .catch(error => showNotification('Error importing file', 'error'));
    }

    function editEntry(id) {
        const entry = knowledgeBase.entries.find(e => e.id === id);
        if (!entry) return;
        
        document.getElementById('modal-title').textContent = 'Edit Entry';
        document.getElementById('entry-id').value = entry.id;
        document.getElementById('question').value = entry.question;
        document.getElementById('answer').value = entry.answer;
        document.getElementById('category').value = entry.category || '';
        document.getElementById('tags').value = entry.tags.join(', ');
        
        document.getElementById('entry-modal').style.display = 'block';
    }

    function deleteEntry(id) {
        if (!confirm('Are you sure you want to delete this entry?')) return;
        
        fetch(`/admin/knowledge-base/entry/${id}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification('Entry deleted successfully');
                loadKnowledgeBase();
            }
        })
        .catch(error => showNotification('Error deleting entry', 'error'));
    }

    // Modal handling
    document.getElementById('entry-form').addEventListener('submit', function(e) {
        e.preventDefault();
        
        const id = document.getElementById('entry-id').value;
        const data = {
            question: document.getElementById('question').value,
            answer: document.getElementById('answer').value,
            category: document.getElementById('category').value,
            tags: document.getElementById('tags').value.split(',').map(t => t.trim())
        };
        
        const url = id ? `/admin/knowledge-base/entry/${id}` : '/admin/knowledge-base/entry';
        const method = id ? 'PUT' : 'POST';
        
        fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification('Entry saved successfully');
                document.getElementById('entry-modal').style.display = 'none';
                loadKnowledgeBase();
            }
        })
        .catch(error => showNotification('Error saving entry', 'error'));
    });

    // Close modal when clicking the X or outside
    document.querySelector('.close').onclick = function() {
        document.getElementById('entry-modal').style.display = 'none';
    }

    window.onclick = function(event) {
        const modal = document.getElementById('entry-modal');
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    }

    // Add search and filter functionality
    document.getElementById('search-input').addEventListener('input', filterEntries);
    document.getElementById('category-filter').addEventListener('change', filterEntries);
    document.getElementById('tag-filter').addEventListener('change', filterEntries);

    function filterEntries() {
        const searchTerm = document.getElementById('search-input').value.toLowerCase();
        const categoryFilter = document.getElementById('category-filter').value;
        const tagFilter = document.getElementById('tag-filter').value;
        
        const filteredEntries = knowledgeBase.entries.filter(entry => {
            const matchesSearch = entry.question.toLowerCase().includes(searchTerm) ||
                                entry.answer.toLowerCase().includes(searchTerm);
            const matchesCategory = !categoryFilter || entry.category === categoryFilter;
            const matchesTag = !tagFilter || entry.tags.includes(tagFilter);
            
            return matchesSearch && matchesCategory && matchesTag;
        });
        
        updateEntriesList(filteredEntries);
    }

    function updateEntriesList(entries) {
        const entriesList = document.getElementById('entries-list');
        entriesList.innerHTML = entries.map(entry => `
            <div class="entry-card">
                <div class="header">
                    <h4>${entry.question}</h4>
                    <div>
                        <button onclick="editEntry('${entry.id}')" class="btn btn-sm btn-primary">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="deleteEntry('${entry.id}')" class="btn btn-sm btn-danger">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <p>${entry.answer}</p>
                <div class="tags">
                    ${entry.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                </div>
                <small class="text-muted">Category: ${entry.category}</small>
            </div>
        `).join('');
    }
}); 