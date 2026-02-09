// متغيرات التطبيق
let rakaatCount = 0;
let currentPose = 'unknown';
let previousPose = 'unknown';
let poseSequence = [];
let isRecording = false;
let camera = null;
let pose = null;
let wakeLock = null;

// وضع Debug
let debugMode = false;
let debugInfo = {
    eyeDistance: 0,
    noseZ: 0,
    faceSize: 0,
    visibility: 0
};

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

// عداد الثبات المحسّن
let poseStabilityCounter = {
    'standing': 0,
    'ruku': 0,
    'sujood': 0,
    'sitting': 0
};
const STABILITY_THRESHOLD = 5; // زيادة العتبة لمزيد من الثبات

// إعدادات الحساسية (قابلة للتعديل)
const SENSITIVITY = {
    // السجود: الوجه قريب جداً
    sujood_min_face_size: 0.18,  // حجم الوجه الأدنى للسجود
    sujood_max_z: -0.2,           // أقرب مسافة z
    
    // الركوع: الوجه متوسط القرب
    ruku_min_face_size: 0.10,
    ruku_max_face_size: 0.18,
    
    // الجلوس: الوجه بعيد نسبياً
    sitting_min_face_size: 0.08,
    sitting_max_face_size: 0.15,
    
    // القيام: الوجه بعيد جداً أو غير مرئي
    standing_max_face_size: 0.08
};

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
    
    // رسم معلومات Debug إذا كان مفعلاً
    if (debugMode) {
        drawDebugInfo();
    }
    
    ctx.restore();

    // تحديد الوضعية
    detectPrayerPoseFromFloor(results.poseLandmarks);
}

// كشف وضعية الصلاة - نسخة محسّنة
function detectPrayerPoseFromFloor(landmarks) {
    const nose = landmarks[0];
    const leftEye = landmarks[2];
    const rightEye = landmarks[5];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    
    // حساب حجم الوجه (المسافة بين العينين)
    const eyeDistance = Math.sqrt(
        Math.pow(leftEye.x - rightEye.x, 2) + 
        Math.pow(leftEye.y - rightEye.y, 2)
    );
    
    // عمق الأنف (البعد عن الكاميرا)
    const noseZ = nose.z;
    
    // حساب حجم الجسم (المسافة بين الكتفين)
    const shoulderDistance = Math.sqrt(
        Math.pow(leftShoulder.x - rightShoulder.x, 2) + 
        Math.pow(leftShoulder.y - rightShoulder.y, 2)
    );
    
    // مستوى الوضوح
    const faceVisibility = (nose.visibility + leftEye.visibility + rightEye.visibility) / 3;
    const shouldersVisible = leftShoulder.visibility > 0.5 && rightShoulder.visibility > 0.5;
    
    // حفظ معلومات Debug
    debugInfo = {
        eyeDistance: eyeDistance.toFixed(3),
        noseZ: noseZ.toFixed(3),
        faceSize: eyeDistance.toFixed(3),
        visibility: faceVisibility.toFixed(2),
        shoulderDist: shoulderDistance.toFixed(3)
    };
    
    let detectedPose = 'unknown';
    
    // ===== منطق الكشف المحسّن =====
    
    // 1️⃣ سجود: الوجه قريب جداً من الكاميرا
    if (faceVisibility > 0.6 && 
        eyeDistance >= SENSITIVITY.sujood_min_face_size && 
        noseZ >= SENSITIVITY.sujood_max_z) {
        detectedPose = 'sujood';
    }
    
    // 2️⃣ ركوع: الجسم العلوي واضح، الوجه متوسط القرب
    else if (shouldersVisible && 
             faceVisibility > 0.5 &&
             eyeDistance >= SENSITIVITY.ruku_min_face_size && 
             eyeDistance < SENSITIVITY.ruku_max_face_size) {
        detectedPose = 'ruku';
    }
    
    // 3️⃣ جلوس: الوجه ظاهر بوضوح، مسافة متوسطة
    else if (faceVisibility > 0.6 &&
             eyeDistance >= SENSITIVITY.sitting_min_face_size && 
             eyeDistance < SENSITIVITY.sitting_max_face_size &&
             noseZ < -0.3) {
        detectedPose = 'sitting';
    }
    
    // 4️⃣ قيام: الوجه بعيد جداً أو غير واضح
    else if (eyeDistance < SENSITIVITY.standing_max_face_size || 
             faceVisibility < 0.4 ||
             noseZ < -0.6) {
        detectedPose = 'standing';
    }
    
    // تطبيق آلية الثبات
    updatePoseStability(detectedPose);
}

// تحديث عداد الثبات - نسخة محسّنة
function updatePoseStability(detectedPose) {
    // زيادة عداد الوضعية المكتشفة
    if (detectedPose !== 'unknown') {
        poseStabilityCounter[detectedPose] += 2; // زيادة أسرع للوضعية الحالية
    }
    
    // تقليل العدادات الأخرى
    for (let p in poseStabilityCounter) {
        if (p !== detectedPose && poseStabilityCounter[p] > 0) {
            poseStabilityCounter[p]--;
        }
    }
    
    // التحقق من الوضعية الأكثر ثباتاً
    let stablePose = null;
    let maxCount = STABILITY_THRESHOLD;
    
    for (let p in poseStabilityCounter) {
        if (poseStabilityCounter[p] >= maxCount) {
            stablePose = p;
            maxCount = poseStabilityCounter[p];
        }
    }
    
    // إذا تغيرت الوضعية بثبات
    if (stablePose && stablePose !== currentPose) {
        previousPose = currentPose;
        currentPose = stablePose;
        onPoseChange(currentPose);
        updatePoseDisplay();
        
        console.log('✅ تغيير الوضعية:', previousPose, '→', currentPose);
    }
}

// عند تغيير الوضعية
function onPoseChange(newPose) {
    // إضافة للتسلسل فقط إذا كانت وضعية مختلفة عن السابقة
    if (poseSequence.length === 0 || poseSequence[poseSequence.length - 1] !== newPose) {
        poseSequence.push(newPose);
        
        console.log('📝 التسلسل:', poseSequence.slice(-6).join(' → '));
        
        // إبقاء آخر 12 حركة
        if (poseSequence.length > 12) {
            poseSequence.shift();
        }
        
        // التحقق من اكتمال ركعة
        checkRakaatComplete();
    }
}

// التحقق من اكتمال ركعة - منطق محسّن ومبسّط
function checkRakaatComplete() {
    const seq = poseSequence;
    
    // نحتاج على الأقل 4 حركات لركعة واحدة
    if (seq.length < 4) return;
    
    // البحث عن نمط الركعة في آخر 8 حركات
    const recent = seq.slice(-8);
    
    // التسلسل المطلوب: standing → ruku → sujood → sujood
    // أو: standing → ruku → sujood → sitting → sujood
    
    let standingIndex = -1;
    let rukuIndex = -1;
    let firstSujoodIndex = -1;
    let secondSujoodIndex = -1;
    
    // البحث عن التسلسل من اليمين لليسار (الأحدث)
    for (let i = recent.length - 1; i >= 0; i--) {
        if (secondSujoodIndex === -1 && recent[i] === 'sujood') {
            secondSujoodIndex = i;
        } else if (secondSujoodIndex !== -1 && firstSujoodIndex === -1 && recent[i] === 'sujood') {
            firstSujoodIndex = i;
        } else if (firstSujoodIndex !== -1 && rukuIndex === -1 && recent[i] === 'ruku') {
            rukuIndex = i;
        } else if (rukuIndex !== -1 && standingIndex === -1 && recent[i] === 'standing') {
            standingIndex = i;
        }
    }
    
    // التحقق من اكتمال النمط
    const isComplete = standingIndex !== -1 && 
                       rukuIndex !== -1 && 
                       firstSujoodIndex !== -1 && 
                       secondSujoodIndex !== -1 &&
                       standingIndex < rukuIndex &&
                       rukuIndex < firstSujoodIndex &&
                       firstSujoodIndex < secondSujoodIndex;
    
    if (isComplete) {
        console.log('🎉 ركعة كاملة! النمط:', recent.join(' → '));
        
        rakaatCount++;
        updateRakaatDisplay();
        highlightSequence();
        
        // إعادة تعيين التسلسل
        poseSequence = [];
        
        // إشعارات
        if ('vibrate' in navigator) {
            navigator.vibrate([300, 100, 300, 100, 300]);
        }
        playCompletionSound();
        
        // إشعار بصري
        showNotification('ركعة رقم ' + rakaatCount + ' ✅');
    }
}

// عرض إشعار بصري
function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'rakaat-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

// تحديث عرض الركعات
function updateRakaatDisplay() {
    rakaatCountEl.textContent = rakaatCount;
    rakaatCountEl.style.animation = 'none';
    setTimeout(() => {
        rakaatCountEl.style.animation = 'pulse 0.6s ease';
    }, 10);
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
            step.style.transform = 'scale(1.15)';
            setTimeout(() => {
                step.style.backgroundColor = '';
                step.style.color = '';
                step.style.transform = '';
            }, 500);
        }, index * 120);
    });
}

// رسم معلومات Debug
function drawDebugInfo() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, 10, 250, 140);
    ctx.fillStyle = '#00FF00';
    ctx.font = '14px monospace';
    
    let y = 30;
    ctx.fillText(`Face Size: ${debugInfo.faceSize}`, 20, y);
    y += 20;
    ctx.fillText(`Nose Z: ${debugInfo.noseZ}`, 20, y);
    y += 20;
    ctx.fillText(`Visibility: ${debugInfo.visibility}`, 20, y);
    y += 20;
    ctx.fillText(`Pose: ${currentPose}`, 20, y);
    y += 20;
    ctx.fillText(`Sequence: ${poseSequence.slice(-3).join('-')}`, 20, y);
    y += 20;
    ctx.fillText(`Rakaat: ${rakaatCount}`, 20, y);
}

// صوت الإكمال
function playCompletionSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // نغمة أولى
        const osc1 = audioContext.createOscillator();
        const gain1 = audioContext.createGain();
        osc1.connect(gain1);
        gain1.connect(audioContext.destination);
        osc1.frequency.value = 800;
        osc1.type = 'sine';
        gain1.gain.setValueAtTime(0.3, audioContext.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        osc1.start(audioContext.currentTime);
        osc1.stop(audioContext.currentTime + 0.2);
        
        // نغمة ثانية
        const osc2 = audioContext.createOscillator();
        const gain2 = audioContext.createGain();
        osc2.connect(gain2);
        gain2.connect(audioContext.destination);
        osc2.frequency.value = 1000;
        osc2.type = 'sine';
        gain2.gain.setValueAtTime(0.3, audioContext.currentTime + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.35);
        osc2.start(audioContext.currentTime + 0.15);
        osc2.stop(audioContext.currentTime + 0.35);
    } catch (error) {
        console.log('لا يمكن تشغيل الصوت');
    }
}

// بدء الكاميرا
async function startCamera() {
    try {
        statusEl.textContent = 'جارٍ تشغيل الكاميرا...';
        
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
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
        
        await requestWakeLock();
        
        console.log('✅ الكاميرا تعمل بنجاح');
        
    } catch (error) {
        console.error('❌ خطأ في تشغيل الكاميرا:', error);
        statusEl.textContent = '❌ خطأ في الكاميرا';
        
        let errorMsg = 'لم يتم السماح بالوصول للكاميرا.\n\n';
        errorMsg += 'يرجى:\n';
        errorMsg += '1. السماح للمتصفح باستخدام الكاميرا\n';
        errorMsg += '2. التأكد من فتح التطبيق عبر HTTPS\n';
        errorMsg += '3. إعادة تحميل الصفحة\n\n';
        errorMsg += 'ملاحظة: التطبيق يجب أن يكون على خادم (Netlify أو GitHub Pages)';
        
        alert(errorMsg);
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
    
    if (wakeLock !== null) {
        wakeLock.release().then(() => {
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
        previousPose = 'unknown';
        
        // إعادة تعيين عدادات الثبات
        for (let p in poseStabilityCounter) {
            poseStabilityCounter[p] = 0;
        }
        
        updateRakaatDisplay();
        updatePoseDisplay();
        
        console.log('🔄 تم إعادة تعيين العداد');
    }
}

// منع النوم
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('🔒 Wake Lock مفعّل - الشاشة لن تنطفئ');
            
            wakeLock.addEventListener('release', () => {
                console.log('🔓 Wake Lock تم إلغاؤه');
            });
        }
    } catch (err) {
        console.log('⚠️ Wake Lock غير متاح:', err);
    }
}

// تبديل وضع Debug
function toggleDebug() {
    debugMode = !debugMode;
    console.log('🐛 وضع Debug:', debugMode ? 'مفعّل' : 'معطّل');
}

// معالجات الأحداث
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
resetBtn.addEventListener('click', resetCounter);

// ضغطة مزدوجة على العداد لتفعيل Debug
rakaatCountEl.addEventListener('dblclick', toggleDebug);

// إعادة تفعيل wake lock عند العودة للصفحة
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// تهيئة التطبيق
window.addEventListener('load', () => {
    initPose();
    console.log('✅ تم تحميل التطبيق بنجاح - نسخة محسّنة v2.0');
    console.log('📱 ضع الهاتف على الأرض أمامك في موضع السجود');
    console.log('💡 اضغط مرتين على العداد لتفعيل وضع Debug');
});

// منع zoom
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('gestureend', e => e.preventDefault());

// منع double-tap zoom
let lastTouchEnd = 0;
document.addEventListener('touchend', event => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);
