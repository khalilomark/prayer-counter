// متغيرات التطبيق
let rakaatCount = 0;
let currentPose = 'unknown';
let previousPose = 'unknown';
let poseSequence = [];
let isRecording = false;
let camera = null;
let pose = null;
let wakeLock = null;

// عناصر DOM
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const rakaatCountEl = document.getElementById('rakaatCount');
const statusEl = document.getElementById('status');
const poseEl = document.getElementById('pose');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');
const sequenceSteps = document.getElementById('sequenceSteps');

// عداد الثبات للتقليل من التذبذب
let poseStabilityCounter = {
    'standing': 0,
    'ruku': 0,
    'sujood': 0,
    'sitting': 0
};
const STABILITY_THRESHOLD = 3; // عدد الإطارات المتتالية المطلوبة لتأكيد الوضعية

// تهيئة MediaPipe Pose
function initPose() {
    pose = new Pose({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }
    });

    pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    pose.onResults(onResults);
}

// معالجة نتائج الكشف
function onResults(results) {
    if (!results.poseLandmarks) {
        currentPose = 'unknown';
        updatePoseDisplay();
        return;
    }

    // رسم الهيكل العظمي
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
        color: '#00FF00',
        lineWidth: 4
    });
    drawLandmarks(ctx, results.poseLandmarks, {
        color: '#FF0000',
        lineWidth: 2,
        radius: 6
    });
    ctx.restore();

    // تحديد الوضعية
    detectPrayerPoseFromFloor(results.poseLandmarks);
}

// كشف وضعية الصلاة من الأرض (الكاميرا تنظر للأعلى)
function detectPrayerPoseFromFloor(landmarks) {
    const nose = landmarks[0];
    const leftEye = landmarks[2];
    const rightEye = landmarks[5];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftElbow = landmarks[13];
    const rightElbow = landmarks[14];
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    
    // حساب المسافات والمواضع
    const noseY = nose.y;
    const noseZ = nose.z; // العمق - البعد عن الكاميرا
    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
    
    // حساب حجم الوجه (للتعرف على القرب من الكاميرا)
    const eyeDistance = Math.abs(leftEye.x - rightEye.x);
    
    // حساب ظهور اليدين
    const handsVisible = (leftWrist.visibility > 0.5 || rightWrist.visibility > 0.5);
    const shouldersVisible = (leftShoulder.visibility > 0.5 && rightShoulder.visibility > 0.5);
    const faceVisible = (nose.visibility > 0.5);
    
    let detectedPose = 'unknown';
    
    // منطق الكشف بناءً على الكاميرا الموضوعة على الأرض:
    
    // سجود: الوجه قريب جداً من الكاميرا (حجم العينين كبير)
    if (faceVisible && eyeDistance > 0.15 && noseZ > -0.3) {
        detectedPose = 'sujood';
    }
    // ركوع: الجسم العلوي واليدين ظاهرة، الوجه متوسط القرب
    else if (shouldersVisible && handsVisible && eyeDistance > 0.08 && eyeDistance < 0.15) {
        detectedPose = 'ruku';
    }
    // جلوس: الجسم السفلي ظاهر، الوجه بعيد نسبياً
    else if (shouldersVisible && eyeDistance > 0.05 && eyeDistance < 0.10 && noseY > 0.3) {
        detectedPose = 'sitting';
    }
    // قيام: الشخص بعيد أو غير ظاهر بوضوح (عند الوقوف)
    else if ((!faceVisible || eyeDistance < 0.05) || noseZ < -0.5) {
        detectedPose = 'standing';
    }
    
    // تطبيق آلية الثبات لتقليل التذبذب
    updatePoseStability(detectedPose);
}

// تحديث عداد الثبات
function updatePoseStability(detectedPose) {
    // زيادة عداد الوضعية المكتشفة
    if (detectedPose !== 'unknown') {
        poseStabilityCounter[detectedPose]++;
    }
    
    // التحقق من الوضعية الأكثر ثباتاً
    let stablePose = currentPose;
    let maxCount = STABILITY_THRESHOLD;
    
    for (let pose in poseStabilityCounter) {
        if (poseStabilityCounter[pose] >= maxCount) {
            stablePose = pose;
            maxCount = poseStabilityCounter[pose];
        }
    }
    
    // إذا تغيرت الوضعية بثبات
    if (stablePose !== currentPose && stablePose !== 'unknown') {
        previousPose = currentPose;
        currentPose = stablePose;
        onPoseChange(currentPose);
        updatePoseDisplay();
        
        // إعادة تعيين عدادات الثبات
        for (let p in poseStabilityCounter) {
            poseStabilityCounter[p] = 0;
        }
    }
    
    // تقليل العدادات الأخرى تدريجياً
    for (let p in poseStabilityCounter) {
        if (p !== detectedPose && poseStabilityCounter[p] > 0) {
            poseStabilityCounter[p]--;
        }
    }
}

// عند تغيير الوضعية
function onPoseChange(newPose) {
    poseSequence.push(newPose);
    
    console.log('تغيير الوضعية:', newPose, 'التسلسل:', poseSequence.slice(-5));
    
    // إبقاء آخر 10 حركات فقط
    if (poseSequence.length > 10) {
        poseSequence.shift();
    }

    // التحقق من اكتمال ركعة
    checkRakaatComplete();
}

// التحقق من اكتمال ركعة كاملة
function checkRakaatComplete() {
    // البحث عن التسلسل: قيام -> ركوع -> سجود -> جلوس -> سجود
    // أو على الأقل: قيام -> ركوع -> سجود (مرتين)
    
    const recentSequence = poseSequence.slice(-8); // آخر 8 حركات
    
    if (recentSequence.length < 4) return;
    
    // البحث عن نمط الركعة
    let hasStanding = false;
    let hasRuku = false;
    let sujoodCount = 0;
    let lastSujoodIndex = -1;
    
    for (let i = 0; i < recentSequence.length; i++) {
        if (recentSequence[i] === 'standing') hasStanding = true;
        if (recentSequence[i] === 'ruku' && hasStanding) hasRuku = true;
        if (recentSequence[i] === 'sujood' && hasRuku) {
            sujoodCount++;
            lastSujoodIndex = i;
        }
    }
    
    // ركعة كاملة: قيام + ركوع + سجودين
    if (hasStanding && hasRuku && sujoodCount >= 2) {
        console.log('✅ ركعة كاملة مكتشفة!');
        rakaatCount++;
        updateRakaatDisplay();
        highlightSequence();
        
        // إعادة تعيين التسلسل للبدء بالركعة التالية
        poseSequence = [];
        
        // إشعار اهتزازي
        if ('vibrate' in navigator) {
            navigator.vibrate([200, 100, 200, 100, 200]);
        }
        
        // إشعار صوتي
        playCompletionSound();
    }
}

// تحديث عرض الركعات
function updateRakaatDisplay() {
    rakaatCountEl.textContent = rakaatCount;
    rakaatCountEl.style.animation = 'pulse 0.5s ease';
    setTimeout(() => {
        rakaatCountEl.style.animation = '';
    }, 500);
}

// تحديث عرض الوضعية
function updatePoseDisplay() {
    const poseNames = {
        'standing': '🧍 قيام',
        'ruku': '🙇 ركوع',
        'sujood': '🧎 سجود',
        'sitting': '🪑 جلوس',
        'unknown': '❓ غير محدد'
    };
    
    poseEl.textContent = poseNames[currentPose] || 'غير محدد';
    poseEl.className = 'pose-value pose-' + currentPose;
}

// إبراز التسلسل المكتمل
function highlightSequence() {
    const steps = sequenceSteps.querySelectorAll('.step');
    steps.forEach((step, index) => {
        setTimeout(() => {
            step.style.backgroundColor = '#4CAF50';
            step.style.color = 'white';
            step.style.transform = 'scale(1.1)';
            setTimeout(() => {
                step.style.backgroundColor = '';
                step.style.color = '';
                step.style.transform = '';
            }, 400);
        }, index * 100);
    });
}

// صوت الإكمال
function playCompletionSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
        console.log('لا يمكن تشغيل الصوت');
    }
}

// بدء الكاميرا
async function startCamera() {
    try {
        statusEl.textContent = 'جارٍ تشغيل الكاميرا...';
        
        // طلب الكاميرا الأمامية مع دقة متوسطة (أداء أفضل على الهواتف)
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user', // الكاميرا الأمامية
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: false
        });
        
        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        };
        
        await video.play();
        
        // بدء معالجة الفيديو
        camera = new Camera(video, {
            onFrame: async () => {
                if (isRecording && pose) {
                    await pose.send({ image: video });
                }
            },
            width: 640,
            height: 480
        });
        
        await camera.start();
        isRecording = true;
        statusEl.textContent = '🟢 يعمل';
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        
        // طلب wake lock لمنع إطفاء الشاشة
        await requestWakeLock();
        
    } catch (error) {
        console.error('خطأ في تشغيل الكاميرا:', error);
        statusEl.textContent = '❌ خطأ في الكاميرا';
        alert('لم يتم السماح بالوصول للكاميرا.\n\nيرجى:\n1. السماح للمتصفح باستخدام الكاميرا\n2. التأكد من عدم استخدام تطبيق آخر للكاميرا\n3. إعادة تحميل الصفحة');
    }
}

// إيقاف الكاميرا
function stopCamera() {
    isRecording = false;
    
    if (camera) {
        camera.stop();
        camera = null;
    }
    
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
    
    statusEl.textContent = '⏸️ متوقف';
    startBtn.style.display = 'inline-block';
    stopBtn.style.display = 'none';
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // إلغاء wake lock
    if (wakeLock !== null) {
        wakeLock.release()
            .then(() => {
                wakeLock = null;
            });
    }
}

// إعادة تعيين العداد
function resetCounter() {
    if (confirm('هل تريد إعادة تعيين العداد؟')) {
        rakaatCount = 0;
        poseSequence = [];
        currentPose = 'unknown';
        updateRakaatDisplay();
        updatePoseDisplay();
    }
}

// منع النوم
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock مفعّل - الشاشة لن تنطفئ');
            
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock تم إلغاؤه');
            });
        }
    } catch (err) {
        console.log('Wake Lock غير متاح:', err);
    }
}

// معالجات الأحداث
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
resetBtn.addEventListener('click', resetCounter);

// إعادة تفعيل wake lock عند العودة للصفحة
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// تهيئة التطبيق
window.addEventListener('load', () => {
    initPose();
    console.log('✅ تم تحميل التطبيق بنجاح');
    console.log('📱 ضع الهاتف على الأرض أمامك في موضع السجود');
});

// منع تكبير الشاشة على الهواتف
document.addEventListener('gesturestart', function (e) {
    e.preventDefault();
});

// منع السكرول أثناء الاستخدام
let lastTouchEnd = 0;
document.addEventListener('touchend', function (event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);
