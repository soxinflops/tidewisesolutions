exports.handler = async () => {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { statusCode: 500, body: JSON.stringify({ error: 'VERCEL_TOKEN not set' }) };

  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const teamsRes = await fetch('https://api.vercel.com/v2/teams', { headers: h });
  const teamsData = teamsRes.ok ? await teamsRes.json() : {};
  const team = (teamsData.teams || [])[0];
  const teamId = team?.id;

  const projectsUrl = teamId
    ? `https://api.vercel.com/v9/projects?teamId=${teamId}&limit=100`
    : 'https://api.vercel.com/v9/projects?limit=100';

  const deploysUrl = teamId
    ? `https://api.vercel.com/v6/deployments?teamId=${teamId}&limit=1&state=READY`
    : 'https://api.vercel.com/v6/deployments?limit=1&state=READY';

  const [projRes, deployRes] = await Promise.all([
    fetch(projectsUrl, { headers: h }),
    fetch(deploysUrl,  { headers: h }),
  ]);

  const projData   = projRes.ok   ? await projRes.json()   : {};
  const deployData = deployRes.ok ? await deployRes.json() : {};

  const projects    = projData.projects || [];
  const lastDeploy  = (deployData.deployments || [])[0];
  const lastDeployAge = lastDeploy?.created
    ? Math.round((Date.now() - lastDeploy.created) / 60000)
    : null;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      team_name:       team?.name || 'Personal',
      project_count:   projects.length,
      last_deploy_min: lastDeployAge,
      last_deploy_name: lastDeploy?.name || null,
    }),
  };
};
