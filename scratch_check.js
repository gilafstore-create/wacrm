const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('--- Automations ---');
  const { data: automations } = await supabase.from('automations').select('*');
  console.log(automations);

  console.log('\n--- Recent Webhooks ---');
  const { data: hooks } = await supabase
    .from('website_webhook_deliveries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log(hooks);

  console.log('\n--- Automation Logs ---');
  const { data: logs } = await supabase
    .from('automation_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log(logs);
}

check().catch(console.error);
