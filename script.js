document.addEventListener('DOMContentLoaded', () => {
    createVaccineInputFields();
    const dobInput = document.getElementById('dob');
    if (dobInput) {
        dobInput.max = new Date().toISOString().split("T")[0]; // 생년월일은 오늘 이전만 선택 가능
    }
});

function createVaccineInputFields() {
    const container = document.getElementById('vaccine-inputs');
    if (!container) return;

    Object.keys(VACCINE_DATA).forEach(key => {
        const vaccine = VACCINE_DATA[key];
        const groupDiv = document.createElement('div');
        groupDiv.classList.add('vaccine-group');
        groupDiv.innerHTML = `<h3>${vaccine.name}</h3>`;

        for (let i = 1; i <= vaccine.doses; i++) {
            const doseId = `${key}-dose${i}`;
            const label = document.createElement('label');
            label.setAttribute('for', doseId);
            label.textContent = `${i}차: `;
            label.classList.add('dose-label');

            const input = document.createElement('input');
            input.type = 'date';
            input.id = doseId;
            input.name = doseId;
            input.classList.add('dose-input');
            input.max = new Date().toISOString().split("T")[0]; // 접종일은 오늘 이전만

            groupDiv.appendChild(label);
            groupDiv.appendChild(input);
        }
        container.appendChild(groupDiv);
    });
}

function calculateAge(dobString) {
    if (!dobString) return null;
    const birthDate = new Date(dobString);
    const today = new Date();

    if (birthDate > today) {
        alert("생년월일은 오늘보다 미래일 수 없습니다.");
        return null;
    }

    let years = today.getFullYear() - birthDate.getFullYear();
    let months = today.getMonth() - birthDate.getMonth();
    let days = today.getDate() - birthDate.getDate();

    if (days < 0) {
        months--;
        const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
        days += prevMonth.getDate();
    }
    if (months < 0) {
        years--;
        months += 12;
    }

    const totalMonths = years * 12 + months;
    // 일수가 0보다 작거나 같으면 한달 줄이고 일수 더해주기(더 정확한 총개월수)
    // ex) 2023-01-15 ~ 2023-03-14 -> 1개월 (원래는 2개월로 나옴)
    // 이 부분은 백신 스케줄의 "개월" 기준과 다를 수 있어 일단 표준 나이계산 사용
    
    const totalWeeks = Math.floor((today - birthDate) / (1000 * 60 * 60 * 24 * 7));

    return {
        years,
        months,
        days,
        totalMonths,
        totalWeeks,
        birthDate // Date 객체 자체도 반환하여 규칙 함수에서 사용
    };
}


function getVaccinationHistory() {
    const history = {};
    Object.keys(VACCINE_DATA).forEach(key => {
        history[key] = [];
        for (let i = 1; i <= VACCINE_DATA[key].doses; i++) {
            const input = document.getElementById(`${key}-dose${i}`);
            history[key].push(input && input.value ? new Date(input.value) : null);
        }
    });
    return history;
}

function addTimeToDate(date, unit, value) {
    const newDate = new Date(date);
    if (unit === 'days') {
        newDate.setDate(newDate.getDate() + value);
    } else if (unit === 'weeks') {
        newDate.setDate(newDate.getDate() + value * 7);
    } else if (unit === 'months') {
        newDate.setMonth(newDate.getMonth() + value);
    } else if (unit === 'years') {
        newDate.setFullYear(newDate.getFullYear() + value);
    }
    return newDate;
}

function calculateAndDisplaySchedule() {
    const dob = document.getElementById('dob').value;
    const ageInfo = calculateAge(dob);

    if (!ageInfo) {
        document.getElementById('age-display').textContent = '올바른 생년월일을 입력하세요.';
        clearScheduleTables();
        return;
    }

    document.getElementById('age-display').textContent =
        `현재 나이: 만 ${ageInfo.years}세 ${ageInfo.months}개월 ${ageInfo.days}일 (총 ${ageInfo.totalMonths}개월, 총 ${ageInfo.totalWeeks}주)`;

    const history = getVaccinationHistory();

    const standardSchedule = generateSchedule(ageInfo, history, 'standard');
    const minimumSchedule = generateSchedule(ageInfo, history, 'minimum');

    displaySchedule(standardSchedule, 'standard-schedule-table');
    displaySchedule(minimumSchedule, 'minimum-schedule-table');
}

function generateSchedule(ageInfo, allVaccineHistories, type) { // type: 'standard' or 'minimum'
    const schedule = [];
    const today = new Date();
    today.setHours(0,0,0,0); // 시간 제거

    Object.keys(VACCINE_DATA).forEach(vaccineId => {
        const vaccine = VACCINE_DATA[vaccineId];
        const specificHistory = allVaccineHistories[vaccineId] || Array(vaccine.doses).fill(null);
        let ruleAction = { action: 'recommendNext', nextDoseNumber: 1 }; // Default

        if (vaccine.rules) {
            ruleAction = vaccine.rules(ageInfo, specificHistory, allVaccineHistories, vaccineId);
        }
        
        if (ruleAction.action === 'completed' || ruleAction.action === 'skip' || ruleAction.action === 'wait' || ruleAction.action === 'consult' || ruleAction.action === 'error') {
            schedule.push({
                vaccineName: vaccine.name,
                nextDoseNumber: ruleAction.nextDoseNumber || '-',
                recommendedDate: '-',
                remarks: ruleAction.message || ruleAction.action
            });
            return; // 다음 백신으로
        }

        // recommendNext 또는 minDateOverride, recommendedDateOverride 등
        let nextDoseNumber = ruleAction.nextDoseNumber || (specificHistory.filter(d => d).length + 1);
        if (nextDoseNumber > vaccine.doses && !(vaccineId === 'td' || vaccineId === 'iiv')) { // Td, IIV는 반복 가능
             if (vaccineId === 'hpv' && ruleAction.messageOverride && ruleAction.messageOverride.includes("2회 접종")) {
                // HPV 2회 요법 완료 시
             } else {
                schedule.push({ vaccineName: vaccine.name, nextDoseNumber: '-', recommendedDate: '-', remarks: '모든 차수 완료 또는 확인 필요' });
                return;
             }
        }


        let lastDoseDate = null;
        let numAdministered = 0;
        for (let i = specificHistory.length - 1; i >= 0; i--) {
            if (specificHistory[i]) {
                lastDoseDate = specificHistory[i];
                numAdministered = i + 1;
                break;
            }
        }
        
        nextDoseNumber = numAdministered + 1; // 규칙에서 nextDoseNumber를 명시적으로 주지 않았다면 이걸 사용
        if (ruleAction.nextDoseNumber) nextDoseNumber = ruleAction.nextDoseNumber;


        let baseDateForInterval;
        let intervalConfig;
        let recommendedDate;

        if (ruleAction.recommendedDateOverride) { // 규칙에서 특정 권장일 지정 (예: IJEV 만 6세)
            recommendedDate = new Date(ruleAction.recommendedDateOverride);
        } else if (ruleAction.minDateOverride) { // 규칙에서 특정 최소 시작일 지정 (예: HepB 3차, PPSV23)
             recommendedDate = new Date(ruleAction.minDateOverride);
        } else {
            if (lastDoseDate) {
                baseDateForInterval = new Date(lastDoseDate);
                if (type === 'standard') {
                    // 표준 간격은 다음 차수의 standardIntervals 정의를 따름
                    // standardIntervals는 [ {months:0}, {months:1}, {months:6} ] 와 같이 누적 또는 상대 간격.
                    // 여기서는 단순하게 minIntervals을 확장해서 사용하거나, 더 복잡한 standard interval 해석기가 필요.
                    // 현재 VACCINE_DATA의 standardIntervals는 주로 시작 연령/개월을 나타냄.
                    // 지연 접종은 "최소 간격"을 지키는 것이 더 중요하므로, 표준 스케줄은 최소 간격을 따르되, "권장되는 시기"를 참고.
                    // DTaP 2,4,6개월 -> 2개월 간격. 6개월->15개월 -> 9개월 간격.
                    // 일단 최소 간격을 표준 간격의 근사치로 사용하거나, 각 백신별 표준 "간격"을 별도 정의 필요.
                    // 여기서는 minIntervals을 기본으로 하되, 특정 ageYears/months가 있으면 그것을 우선.
                     intervalConfig = vaccine.minIntervals[numAdministered -1] || vaccine.minIntervals[vaccine.minIntervals.length-1]; // 마지막 간격 반복
                     if (vaccine.standardIntervals[numAdministered]) {
                         const stdInt = vaccine.standardIntervals[numAdministered];
                         if (stdInt.monthsInterval) intervalConfig = { months: stdInt.monthsInterval };
                         else if (stdInt.weeksInterval) intervalConfig = { weeks: stdInt.weeksInterval };
                         // ageYears/months는 절대 시기이므로 아래에서 처리
                     }

                } else { // minimum
                    intervalConfig = vaccine.minIntervals[numAdministered -1] || vaccine.minIntervals[vaccine.minIntervals.length-1];
                }
                 if (ruleAction.minIntervalOverride) intervalConfig = ruleAction.minIntervalOverride;


                if (intervalConfig) {
                    if (intervalConfig.weeks) recommendedDate = addTimeToDate(baseDateForInterval, 'weeks', intervalConfig.weeks);
                    else if (intervalConfig.months) recommendedDate = addTimeToDate(baseDateForInterval, 'months', intervalConfig.months);
                    else if (intervalConfig.yearsInterval) recommendedDate = addTimeToDate(baseDateForInterval, 'years', intervalConfig.yearsInterval);
                    else recommendedDate = new Date(baseDateForInterval); // 간격 없으면 일단 동일날짜, 아래서 조정
                } else {
                     recommendedDate = new Date(baseDateForInterval); // 간격 정의 없으면 일단 이전 접종일
                }

            } else { // 첫 접종
                baseDateForInterval = new Date(ageInfo.birthDate); // 생년월일 기준
                let firstDoseConfig;
                if (type === 'standard' && vaccine.standardIntervals[0]) {
                     firstDoseConfig = vaccine.standardIntervals[0];
                } else if (type === 'minimum' && vaccine.minIntervals[0]) { // 첫 접종 최소시작일 (대부분 없음)
                     firstDoseConfig = vaccine.minIntervals[0];
                } else { // 기본값 (오늘부터 가능)
                    firstDoseConfig = { fromToday: true };
                }

                if (firstDoseConfig.months) recommendedDate = addTimeToDate(baseDateForInterval, 'months', firstDoseConfig.months);
                else if (firstDoseConfig.ageYears) {
                    recommendedDate = new Date(baseDateForInterval);
                    recommendedDate.setFullYear(recommendedDate.getFullYear() + firstDoseConfig.ageYears);
                } else if (firstDoseConfig.ageMonths) { // 생후 특정 개월
                    recommendedDate = new Date(baseDateForInterval);
                    recommendedDate.setMonth(recommendedDate.getMonth() + firstDoseConfig.ageMonths);
                }
                else if (firstDoseConfig.isAnnual) { // 인플루엔자
                     recommendedDate = new Date(today.getFullYear(), firstDoseConfig.startMonth || 8, 1); // 올해 9월 1일
                     if (today > recommendedDate && today.getMonth() > (firstDoseConfig.endMonth || 11)) { // 이미 시즌 지났으면 내년
                        recommendedDate.setFullYear(today.getFullYear() + 1);
                     }
                }
                 else { // fromToday or no specific start for first dose after birth
                    recommendedDate = new Date(today); // 오늘부터 가능
                }
            }
        }


        // 특정 연령/개월 조건이 있다면 (예: MMR 1차는 12개월 이후)
        // vaccine.standardIntervals[numAdministered] 가 그 차수의 표준 "시기"를 의미
        if (vaccine.standardIntervals[numAdministered]) {
            const stdTiming = vaccine.standardIntervals[numAdministered];
            let ageBasedMinDate;
            if (stdTiming.ageYears) {
                ageBasedMinDate = new Date(ageInfo.birthDate);
                ageBasedMinDate.setFullYear(ageBasedMinDate.getFullYear() + stdTiming.ageYears);
            } else if (stdTiming.ageMonths) { // 생후 12개월 등
                ageBasedMinDate = new Date(ageInfo.birthDate);
                ageBasedMinDate.setMonth(ageBasedMinDate.getMonth() + stdTiming.ageMonths);
            } else if (stdTiming.months && numAdministered === 0) { // 첫 접종시 생후 X개월 (BCG)
                 ageBasedMinDate = new Date(ageInfo.birthDate);
                 ageBasedMinDate.setMonth(ageBasedMinDate.getMonth() + stdTiming.months);
                 if(stdTiming.recommendedAgeMonths) { // BCG 4주이내
                    let recMaxAge = new Date(ageInfo.birthDate);
                    recMaxAge.setMonth(recMaxAge.getMonth() + stdTiming.recommendedAgeMonths);
                    if (recommendedDate > recMaxAge && type==='standard') recommendedDate = new Date(recMaxAge); // 표준은 권장상한 넘지않게
                 }
            }

            if (ageBasedMinDate && recommendedDate < ageBasedMinDate) {
                recommendedDate = ageBasedMinDate;
            }
        }
        // 규칙에서 minAgeOverride가 있다면 (예: Hib/PCV 추가접종은 12개월 이후)
        if (ruleAction.minAgeOverride) {
            const minAgeDate = new Date(ruleAction.minAgeOverride);
            if (recommendedDate < minAgeDate) {
                recommendedDate = minAgeDate;
            }
        }


        // 최종 권장일은 오늘보다 과거일 수 없음
        if (recommendedDate < today) {
            recommendedDate = new Date(today);
        }
        
        // HPV 2회차 최소 간격 5개월, 권장 6개월
        if (vaccineId === 'hpv' && numAdministered === 1 && intervalConfig && intervalConfig.months === 6 && intervalConfig.minMonths === 5) {
            if (type === 'minimum') {
                 recommendedDate = addTimeToDate(baseDateForInterval, 'months', intervalConfig.minMonths);
                 if (recommendedDate < today) recommendedDate = new Date(today);
            }
        }
        // HPV 3회차 1-3차 최소 5개월
        if (vaccineId === 'hpv' && numAdministered === 2 && ruleAction.minDateOverride && type === 'minimum') {
             if (recommendedDate < ruleAction.minDateOverride) recommendedDate = new Date(ruleAction.minDateOverride);
             if (recommendedDate < today) recommendedDate = new Date(today);
        }


        schedule.push({
            vaccineName: vaccine.name,
            nextDoseNumber: nextDoseNumber,
            recommendedDate: formatDate(recommendedDate),
            remarks: ruleAction.messageOverride || (vaccineId === 'td' ? '10년마다' : (vaccineId === 'iiv' && nextDoseNumber === 1 ? '매년' : ''))
        });
    });
    return schedule;
}


function displaySchedule(scheduleData, tableId) {
    const tableBody = document.getElementById(tableId).getElementsByTagName('tbody')[0];
    if (!tableBody) return;
    tableBody.innerHTML = ''; // Clear previous results

    if (scheduleData.length === 0) {
        const row = tableBody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 4; // 병합
        cell.textContent = '계산된 스케줄이 없습니다. 입력값을 확인해주세요.';
        cell.style.textAlign = 'center';
        return;
    }

    scheduleData.forEach(item => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = item.vaccineName;
        row.insertCell().textContent = item.nextDoseNumber;
        row.insertCell().textContent = item.recommendedDate;
        row.insertCell().textContent = item.remarks || '';
    });
}

function clearScheduleTables() {
    const stdTableBody = document.getElementById('standard-schedule-table').getElementsByTagName('tbody')[0];
    const minTableBody = document.getElementById('minimum-schedule-table').getElementsByTagName('tbody')[0];
    if (stdTableBody) stdTableBody.innerHTML = '';
    if (minTableBody) minTableBody.innerHTML = '';
}

// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return 'N/A';
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}